import net from "node:net";
import pg from "pg";
import { env } from "./env.js";
import { HttpError } from "./http.js";

// Node gives each address in a DNS answer only 250ms to complete its TCP
// handshake before moving to the next one, and gives up when it runs out. Neon
// answers with several A records and one round trip to eu-central-1 is already
// close to that from outside the region, so connections failed at random with
// an AggregateError of ETIMEDOUT — measured here as 3 failures in 5. The
// handshake is not slow, the budget is small.
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

// Return NUMERIC/DECIMAL columns as JS numbers (oid 1700) rather than strings,
// matching what supabase-js used to hand back — the clients expect `amount`,
// spending limits, budgets, etc. to be numbers, not strings.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

/**
 * Which URL to connect on.
 *
 * The pooled endpoint is PgBouncer in transaction mode, so a session-level
 * `SET search_path` is never dependable there — it lands on whichever server
 * connection served that statement and leaks to whoever gets it next. That is
 * exactly what broke dev: the test harness set its own schema, teardown
 * dropped it, and later requests found current_schema() null.
 *
 * On `public` we need no SET at all — it is the role's default — so the pooler
 * is used and nothing is left behind. When a different schema is asked for
 * (only the test harness does), we take the direct endpoint, where a session
 * setting means what it says.
 */
const CONNECTION_URL =
  env.dbSchema === "public" ? env.databaseUrl : env.databaseUrl.replace(/-pooler\./, ".");

export const pool = new pg.Pool({
  connectionString: CONNECTION_URL,
  // Neon's `-pooler` endpoint (PgBouncer, transaction mode) multiplexes many
  // client connections onto few server connections, so a high client `max` is
  // safe and recommended. The old max:10 saturated under concurrent load
  // (k6 p95 6.27s, 7.5% connection-timeout failures) — every slow query held
  // one of only 10 slots and the rest queued until k6 gave up.
  max: 50,
  // The pooler keeps a warm compute behind it and answers at once. The direct
  // endpoint does not: a suspended Neon compute takes several seconds to wake,
  // and 5s was close enough to that to fail the test suite at random.
  // Tunable (DB_CONNECT_TIMEOUT_MS): 5s is plenty next to the database, but
  // from a distant dev machine a TLS handshake plus a Neon wake-up can pass it,
  // and the failure shows up as a bare "Internal server error".
  connectionTimeoutMillis: env.dbSchema === "public"
    ? Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000
    : 30000,
  idleTimeoutMillis: 30000,
  allowExitOnIdle: true,
  // Neon (and the networks in front of it) silently drop idle connections;
  // keep-alive probes make that rarer and surface it sooner.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// A connection that dies while IDLE in the pool emits 'error' on the pool. With
// no listener Node treats that as an uncaught exception and the whole API exits
// ("Connection terminated unexpectedly" / ECONNRESET took the dev server down).
// pg already discards the dead client; all we must do is not crash.
pool.on("error", (err) => {
  console.error("[db] idle client error (connection dropped, will reconnect on demand):", err.message);
});

const CONNECT_RETRY_RE =
  /timeout exceeded when trying to connect|connection terminated|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN/i;

/**
 * pool.connect() with a short retry. Only the connect phase is retried — no
 * statement has run yet, so a retry can never repeat a write.
 */
export async function connectWithRetry(attempts = 3): Promise<pg.PoolClient> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await pool.connect();
    } catch (err: any) {
      lastErr = err;
      const msg = `${err?.message ?? ""} ${err?.code ?? ""}`;
      if (i === attempts || !CONNECT_RETRY_RE.test(msg)) break;
      console.warn(`[db] connect attempt ${i}/${attempts} failed (${err?.message || err?.code}); retrying`);
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
  throw lastErr;
}

// Only a non-default schema needs stating, and by then we are on the direct
// endpoint where a session setting holds for the life of the connection.
//
// `pool.on("connect")` is not awaited by pg, so a query can beat it — which is
// why this is done in the query path instead.
const readied = new WeakSet<pg.PoolClient>();

async function ready(client: pg.PoolClient): Promise<void> {
  if (env.dbSchema === "public" || readied.has(client)) return;
  await client.query(`SET search_path TO ${env.dbSchema}`);
  readied.add(client);
}

/** Run something on a client whose schema is known to be right. */
export async function withSchema<T>(
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connectWithRetry();
  try {
    await ready(client);
    return await run(client);
  } finally {
    client.release();
  }
}

export type Row = Record<string, unknown>;

/** Run a query and return all rows. */
export async function rows<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await withSchema((c) => c.query(text, params));
  return res.rows as T[];
}

/** Run a query and return the first row, or null if none. */
export async function maybeOne<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const res = await withSchema((c) => c.query(text, params));
  return (res.rows[0] as T) ?? null;
}

/** Run a query and return the first row, or throw 404 if none (like .single()). */
export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T> {
  const res = await withSchema((c) => c.query(text, params));
  const row = res.rows[0] as T | undefined;
  if (!row) throw new HttpError(404, "Not found.", "not_found");
  return row;
}

/** Run a query for its side effects; returns the row count affected. */
export async function exec(text: string, params: unknown[] = []): Promise<number> {
  const res = await withSchema((c) => c.query(text, params));
  return res.rowCount ?? 0;
}

/**
 * UPDATE `table` SET (provided fields) WHERE id = $1 RETURNING *. `undefined`
 * fields are skipped. `table` and field keys are always code-controlled (never
 * user input), so the interpolation here is safe. Throws 404 if no row matches.
 */
export async function updateById<T = Row>(
  table: string,
  id: string,
  fields: Record<string, unknown>,
  // Columns to return. Defaults to everything, but a table holding something
  // that must not be echoed back — items.photo_data is a whole image — passes
  // its own list so a PATCH answers with the same shape as a GET.
  returning = "*",
): Promise<T> {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length === 0) {
    return one<T>(`select ${returning} from ${table} where id = $1`, [id]);
  }
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  return one<T>(
    `update ${table} set ${set} where id = $1 returning ${returning}`,
    [id, ...keys.map((k) => fields[k])],
  );
}

/** Run `fn` inside a transaction, committing on success and rolling back on error. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await connectWithRetry();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

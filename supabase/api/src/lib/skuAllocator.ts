/**
 * Handing out the next free SKU for an item type.
 *
 * Split from `sku.ts` so the formatting rules stay pure and unit-testable; this
 * is the half that has to ask the database what is already taken.
 */
import { rows } from "../db.js";
import { formatSku, highestSeq, skuPattern } from "./sku.js";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/** How many times to re-read and retry when two inserts race for a number. */
const MAX_ATTEMPTS = 5;

/**
 * The next unused SKU for `type`.
 *
 * Derived from the highest sequence already issued under the type's prefix, not
 * from a row count: deleting `vrlt-cbl-002` of three must not hand `003` back
 * out to a new item and collide with the one that already holds it.
 */
export async function allocateSku(type: string): Promise<string> {
  const taken = await rows<{ sku: string | null }>(
    `select sku from items where sku like $1`,
    [skuPattern(type)],
  );
  const next = highestSeq(taken.map((r) => r.sku)) + 1;
  console.log(`[sku] allocating ${formatSku(type, next)} for type "${type}"`);
  return formatSku(type, next);
}

/**
 * Run `insert` with a freshly allocated SKU, retrying if another request took
 * the same number first.
 *
 * Reading the highest sequence and inserting are two statements, so two items
 * of the same type created at once can both read `002`. The loser comes back as
 * a unique violation on `items.sku`; re-reading and trying again resolves it
 * without holding a lock across the whole request.
 */
export async function withAllocatedSku<T>(
  type: string,
  insert: (sku: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const sku = await allocateSku(type);
    try {
      return await insert(sku);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== UNIQUE_VIOLATION) throw error;
      lastError = error;
      console.warn(`[sku] ${sku} was taken mid-insert; retry ${attempt}/${MAX_ATTEMPTS}`);
    }
  }
  throw lastError;
}

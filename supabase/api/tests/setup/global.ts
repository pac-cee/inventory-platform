import supertest from "supertest";
import { createApp } from "../../src/app.js";
import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

loadDotenv();
// env.ts layers .env.test on top of .env when APP_ENV=test, but globalSetup
// runs before the app module is imported, so load it explicitly here.
if (process.env.APP_ENV) {
  loadDotenv({ path: `.env.${process.env.APP_ENV}`, override: true });
}

const TEST_SCHEMA = "test";
const ADMIN_EMAIL = "test-admin@inventory.test";
const MEMBER_EMAIL = "test-member@inventory.test";
const MANAGER_EMAIL = "test-manager@inventory.test";
const TEST_PASSWORD = "TestPass123!";

// Direct Neon connection for DDL (pooled endpoint is unreliable for schema
// work). Stripping `-pooler` also stops this harness poisoning the shared
// pooler: a `SET search_path` here would persist on a multiplexed server
// connection, and teardown then drops that schema — leaving a dev request on
// the same connection with current_schema() = null and every table missing.
const DATABASE_URL = (process.env.DATABASE_URL ?? "").replace(/-pooler\./, ".");
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set (via .env + .env.test) to run tests");
}

// Apply schema.sql with search_path pointed at the isolated test schema.
async function applySchema(client: Pool): Promise<void> {
  // Start from nothing. Teardown drops the schema, but it doesn't run if the
  // process is killed or setup itself failed part-way — and schema.sql is all
  // `create ... if not exists`, so a survivor was silently REUSED with the
  // previous run's rows still in it. That produced failures that looked like
  // code bugs (a payments test seeing a budget another run had allocated) and
  // wasted time chasing them. Dropping here makes every run start clean
  // regardless of how the last one ended.
  await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
  // Include `public` so extensions installed there (citext, pgcrypto) resolve,
  // while unqualified table DDL still lands in the test schema first.
  await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
  const schemaPath = fileURLToPath(
    new URL("../../db/schema.sql", import.meta.url),
  );
  const schema = readFileSync(schemaPath, "utf8");
  // Run schema.sql as one block; it uses unqualified table names, so they land
  // in the test schema via the search_path set above.
  await client.query(schema);

  // Search_path quirk: under `test, public`, FK targets in schema.sql can
  // resolve to the empty `public` copy of a table instead of `test`. Re-point
  // the low_stock_alerts FKs to `test` so inserts from the E4 checker succeed.
  // (Test harness only — production migrations don't use this applySchema path.)
  await client.query(`SET search_path TO ${TEST_SCHEMA}`);
  await client.query(
    `alter table ${TEST_SCHEMA}.low_stock_alerts
       drop constraint if exists low_stock_alerts_item_id_fkey,
       drop constraint if exists low_stock_alerts_location_id_fkey`,
  );
  await client.query(
    `alter table ${TEST_SCHEMA}.low_stock_alerts
       add constraint low_stock_alerts_item_id_fkey
         foreign key (item_id) references ${TEST_SCHEMA}.items(id) on delete cascade,
       add constraint low_stock_alerts_location_id_fkey
         foreign key (location_id) references ${TEST_SCHEMA}.locations(id) on delete cascade`,
  );
}

async function createTestUsers(): Promise<void> {
  // Sign up + promote in-process (no live server needed) via supertest,
  // same as the route tests use. Idempotent: re-runs tolerate existing users.
  const app = supertest(createApp());
  for (const email of [ADMIN_EMAIL, MEMBER_EMAIL, MANAGER_EMAIL]) {
    const res = await app
      .post("/auth/signup")
      .send({ email, password: TEST_PASSWORD });
    if (res.status !== 201 && res.status !== 400) {
      throw new Error(`signup for ${email} returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }
  // Promote admin via direct DB update in the test schema.
  const client = new Pool({
    connectionString: DATABASE_URL,
    max: 1,
  });
  try {
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    const { rows } = await client.query(
      "select id from users where email = $1",
      [ADMIN_EMAIL],
    );
    if (rows[0]) {
      await client.query("update profiles set role = 'admin' where id = $1", [
        rows[0].id,
      ]);
    }
    // The inventory manager (0039): stock powers, no user management.
    await client.query(
      "update profiles set role = 'stock_manager' where id in (select id from users where email = $1)",
      [MANAGER_EMAIL],
    );
    // E3: signup now creates UNVERIFIED users; confirm the test accounts
    // so the rest of the suite can authenticate. (Real users verify via email.)
    await client.query(
      "update users set email_confirmed = true where email = $1 or email = $2 or email = $3",
      [ADMIN_EMAIL, MEMBER_EMAIL, MANAGER_EMAIL],
    );
    // 0037: signup also creates accounts blocked and awaiting an admin. There
    // is no admin yet to approve these two, so the seed does it. (Real users
    // are approved by an admin unblocking them.)
    await client.query(
      `update profiles set approval_status = 'approved', blocked = false
         where id in (select id from users where email = $1 or email = $2 or email = $3)`,
      [ADMIN_EMAIL, MEMBER_EMAIL, MANAGER_EMAIL],
    );
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  const client = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await applySchema(client);
  } finally {
    await client.end();
  }
  await createTestUsers();
  console.log(`[globalSetup] test schema '${TEST_SCHEMA}' ready`);
}

export async function teardown(): Promise<void> {
  const client = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    console.log(`[globalTeardown] dropped schema '${TEST_SCHEMA}'`);
  } finally {
    await client.end();
  }
}

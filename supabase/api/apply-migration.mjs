// One-off migration runner: applies a SQL file to Neon via the `pg` client.
// Usage (from supabase/api):  DATABASE_URL=<neon-url> node apply-migration.mjs <file.sql>
// Read-only safe: this script does NOT drop/create databases — just runs the
// statements in the file. Each statement is executed in its own query.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: DATABASE_URL=... node apply-migration.mjs <file.sql>");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — export it (from Doppler/Railway) first.");
  process.exit(1);
}

const sql = readFileSync(resolve(file), "utf8");
const pool = new pg.Pool({ connectionString: url, max: 1 });

try {
  // Run the whole file as one script (Postgres handles multiple statements).
  await pool.query(sql);
  console.log(`OK: applied ${file}`);
} catch (e) {
  // See verify-schema.mjs: a dropped Neon connection surfaces with no message.
  const why = e.message || e.code || e.constructor?.name || String(e);
  console.error(`FAILED: ${why}`);
  if (!e.message) {
    console.error("(empty error — usually a dropped Neon connection; just run it again)");
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}

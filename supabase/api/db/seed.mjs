// Seed script: creates a first admin, a couple of locations/items, and some
// initial stock. Run with: node db/seed.mjs  (reads DATABASE_URL from .env)
import "dotenv/config";
import pg from "pg";
// `bcrypt`, not `bcryptjs` — that is what package.json depends on and what
// auth-service.ts hashes with, so a seeded password verifies at login.
import bcrypt from "bcrypt";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@verlet.io";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Admin1234!";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // --- Admin user ---
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const existing = await client.query("select id from users where email = $1", [ADMIN_EMAIL]);
    let adminId;
    if (existing.rows[0]) {
      adminId = existing.rows[0].id;
      await client.query("update users set password_hash = $1, email_confirmed = true where id = $2", [hash, adminId]);
      await client.query("update profiles set role = 'admin', has_payment_permission = true where id = $1", [adminId]);
      console.log("Updated existing admin:", ADMIN_EMAIL);
    } else {
      const u = await client.query(
        "insert into users (email, password_hash, email_confirmed) values ($1, $2, true) returning id",
        [ADMIN_EMAIL, hash],
      );
      adminId = u.rows[0].id;
      await client.query(
        "insert into profiles (id, full_name, role, has_payment_permission) values ($1, 'Verlet Admin', 'admin', true)",
        [adminId],
      );
      console.log("Created admin:", ADMIN_EMAIL);
    }

    // --- Locations ---
    const locNames = ["Main Warehouse", "Lab A", "Field Kit"];
    const locIds = {};
    for (const name of locNames) {
      const r = await client.query(
        // 0030 made the top-level name index PARTIAL, so the conflict target has
        // to repeat its predicate or Postgres cannot infer the index (42P10).
        `insert into locations (name) values ($1)
           on conflict (name) where archived_at is null and parent_id is null
           do update set name = excluded.name returning id`,
        [name],
      );
      locIds[name] = r.rows[0].id;
    }

    // --- Items ---
    // Type + name + model, with the SKU assigned the same way the API assigns
    // it (lib/sku.ts) — here via the DB's item_sku_prefix so the two agree.
    // The three Cables show the scheme: vrlt-cbl-001, -002, -003.
    const items = [
      { type: "Cable", name: "Patch Lead 3m", model: "CAT6-3M", specification: "RJ45, shielded", finishable: false },
      { type: "Cable", name: "Patch Lead 5m", model: "CAT6-5M", specification: "RJ45, shielded", finishable: false },
      { type: "Cable", name: "USB-C 1m", model: "USBC-1M", specification: "100W PD", finishable: false },
      { type: "Stepper Motor", name: "NEMA 17", model: "17HS4401", specification: "1.8° bipolar stepper", finishable: false },
      { type: "PLA Filament", name: "Black Spool", model: "PLA-BLK", specification: "1.75mm, 1kg spool", finishable: true },
      { type: "Socket Screws", name: "M3x10", model: "DIN912", specification: "Stainless, bag of 100", finishable: true },
      { type: "Raspberry Pi", name: "Pi 5", model: "8GB", specification: "8GB RAM", finishable: false },
    ];
    const itemIds = {};
    // Per-type running number, so each type's items are numbered from 001.
    const seqByType = {};
    for (const it of items) {
      seqByType[it.type] = (seqByType[it.type] ?? 0) + 1;
      const r = await client.query(
        `insert into items (sku, type, name, model, specification, finishable)
           values ('vrlt-' || item_sku_prefix($1) || '-' || lpad($6::text, 3, '0'),
                   $1, $2, $3, $4, $5)
           on conflict (sku) do update set name = excluded.name returning id, sku`,
        [it.type, it.name, it.model, it.specification, it.finishable, seqByType[it.type]],
      );
      itemIds[`${it.type}|${it.name}`] = r.rows[0].id;
    }

    // --- Initial stock via movements (exercises the trigger) ---
    const stock = [
      ["Cable|Patch Lead 3m", "Main Warehouse", 40],
      ["Cable|Patch Lead 5m", "Main Warehouse", 25],
      ["Stepper Motor|NEMA 17", "Main Warehouse", 40],
      ["PLA Filament|Black Spool", "Main Warehouse", 25],
      ["Socket Screws|M3x10", "Main Warehouse", 500],
      ["Raspberry Pi|Pi 5", "Lab A", 8],
    ];
    for (const [key, loc, qty] of stock) {
      const already = await client.query(
        "select 1 from item_stock where item_id = $1 and location_id = $2",
        [itemIds[key], locIds[loc]],
      );
      if (already.rows[0]) continue;
      await client.query(
        `insert into stock_movements (item_id, location_id, user_id, delta, capacity_delta, reason, note)
           values ($1, $2, $3, $4, $4, 'initial', 'Seed stock')`,
        [itemIds[key], locIds[loc], adminId, qty],
      );
    }

    // --- Current month budget so the payments flow has headroom ---
    const now = new Date();
    await client.query(
      `insert into monthly_budgets (year, month, allocated_amount, remaining_amount)
         values ($1, $2, 1000000, 1000000)
         on conflict (year, month) do nothing`,
      [now.getUTCFullYear(), now.getUTCMonth() + 1],
    );

    await client.query("COMMIT");
    console.log("\nSeed complete.");
    console.log(`Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

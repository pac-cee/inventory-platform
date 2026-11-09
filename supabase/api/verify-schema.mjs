// Reports which of the recent migrations a database already has.
//
// There is no migration-tracking table (apply-migration.mjs keeps no record),
// so "has 0030 been run on prd?" is otherwise answered by reading DDL by hand.
// This checks the marker each migration leaves behind.
//
// Usage (from supabase/api):
//   DATABASE_URL=<neon-url> node verify-schema.mjs
//
// Read-only: it runs SELECTs only, so it is safe against production.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — export it (from Doppler/Railway) first.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 20000 });

const q = async (text, params = []) => (await pool.query(text, params)).rows;

try {
  const cols = await q(
    `select table_name, column_name from information_schema.columns
      where table_schema = current_schema()
        and (table_name, column_name) in (('items','package_label'), ('locations','archived_at'), ('corporate_transactions','recipient_name'),
                                          ('item_stock','container_label'),
                                          ('items','category'),
                                          ('stock_movements','recommendation'),
                                          ('stock_movements','resolves'),
                                          ('items','photo_url'),
                                          ('locations','photo_url'),
                                          ('item_stock','slot_no'),
                                          ('profiles','approval_status'),
                                          ('password_resets','new_password_hash'),
                                          ('items','type'),
                                          ('items','model'),
                                          ('transaction_products','type'),
                                          ('profiles','can_manage_inventory'),
                                          ('locations','kind'),
                                          ('locations','label'),
                                          ('locations','qr_token'))`,
  );
  const has = (t, c) => cols.some((r) => r.table_name === t && r.column_name === c);

  const [reason] = await q(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'stock_movements_reason_check'`,
  );
  const reasonDef = reason?.def ?? "";

  const idx = (await q(
    `select indexname from pg_indexes
      where tablename in ('locations', 'item_stock', 'profiles', 'password_resets', 'items',
                          'loan_due_dates', 'reservations', 'loan_reminders')
        and schemaname = current_schema()`,
  )).map((r) => r.indexname);

  const [{ n: globalNameConstraint }] = await q(
    `select count(*)::int as n from pg_constraint where conname = 'locations_name_key'`,
  );

  const [{ n: brokenTotals }] = await q(
    `select count(*)::int as n from item_stock where capacity < quantity + damaged`,
  );

  const tables = (
    await q(
      `select table_name from information_schema.tables
        where table_schema = current_schema()
          and table_name in ('password_resets','low_stock_alerts','item_suggestions','vendors','direct_purchases','direct_purchase_lines','device_tokens','notification_prefs','notification_outbox')`,
    )
  ).map((r) => r.table_name);

  const checks = [
    ["0027 item packages + transfer", has("items", "package_label") && reasonDef.includes("'transfer'")],
    ["0028 totals healed", brokenTotals === 0, brokenTotals > 0 ? `${brokenTotals} row(s) still under-counted` : ""],
    ["0029 location archive", has("locations", "archived_at")],
    [
      "0030 names unique per parent",
      idx.includes("locations_name_per_parent_key") &&
        idx.includes("locations_name_top_level_key") &&
        globalNameConstraint === 0,
      globalNameConstraint > 0 ? "the old global locations_name_key is still there" : "",
    ],
    ["0031 reassign reason", reasonDef.includes("'reassign'")],
    [
      "0032 password_resets + low_stock_alerts",
      // Name the tables rather than counting: the query fetches others too, so
      // a length check silently breaks every time one is added.
      tables.includes("password_resets") && tables.includes("low_stock_alerts"),
      !(tables.includes("password_resets") && tables.includes("low_stock_alerts"))
        ? `missing ${["password_resets", "low_stock_alerts"].filter((t) => !tables.includes(t)).join(", ")} — password reset and low-stock alerts fail at runtime without them`
        : "",
    ],
    [
      "0033 condition report columns",
      has("items", "category") &&
        has("stock_movements", "recommendation") &&
        has("stock_movements", "resolves"),
      "",
    ],
    ["0034 item photo_url", has("items", "photo_url")],
    ["0035 item_suggestions", tables.includes("item_suggestions")],
    ["0036 location photos", has("locations", "photo_url")],
    [
      "0036 per-location item numbers",
      has("item_stock", "slot_no") && idx.includes("item_stock_slot_no_key"),
      // Without the trigger the column exists but stays null on every new row.
      !idx.includes("item_stock_slot_no_key") ? "the unique index is missing" : "",
    ],
    [
      "0037 account approval",
      has("profiles", "approval_status") && idx.includes("profiles_pending_approval_idx"),
      !idx.includes("profiles_pending_approval_idx") ? "the pending index is missing" : "",
    ],
    [
      "0038 password reset confirmation",
      has("password_resets", "new_password_hash") && idx.includes("password_resets_pending_idx"),
      !idx.includes("password_resets_pending_idx") ? "the pending index is missing" : "",
    ],
    [
      "0047 push foundation",
      tables.includes("device_tokens") && tables.includes("notification_prefs") && tables.includes("notification_outbox"),
      ["device_tokens", "notification_prefs", "notification_outbox"].filter((t) => !tables.includes(t)).map((t) => `missing ${t}`).join(", "),
    ],
    [
      "0046 direct purchases",
      tables.includes("vendors") && tables.includes("direct_purchases") && tables.includes("direct_purchase_lines"),
      ["vendors", "direct_purchases", "direct_purchase_lines"].filter((t) => !tables.includes(t)).map((t) => `missing ${t}`).join(", "),
    ],
    ["0045 transaction recipient name", has("corporate_transactions", "recipient_name")],
    [
      "0044 loan reminders",
      idx.includes("loan_reminders_pkey"),
      !idx.includes("loan_reminders_pkey") ? "the loan_reminders table is missing" : "",
    ],
    [
      "0043 reservations",
      idx.includes("reservations_item_loc_idx"),
      !idx.includes("reservations_item_loc_idx") ? "the reservations table is missing" : "",
    ],
    [
      "0042 loan due dates",
      idx.includes("loan_due_dates_due_idx"),
      !idx.includes("loan_due_dates_due_idx") ? "the loan_due_dates table is missing" : "",
    ],
    [
      "0041 containers (kind, label, qr_token)",
      has("locations", "kind") && has("locations", "label") && has("locations", "qr_token") && idx.includes("locations_qr_token_key"),
      !idx.includes("locations_qr_token_key") ? "the qr_token unique index is missing" : "",
    ],
    [
      "0040 stock_manager role + inventory access",
      has("profiles", "can_manage_inventory") && idx.includes("profiles_inventory_idx"),
      !idx.includes("profiles_inventory_idx") ? "the profiles_inventory_idx index is missing" : "",
    ],
    [
      "0039 item type + model + assigned SKU",
      has("items", "type") &&
        has("items", "model") &&
        has("transaction_products", "type") &&
        idx.includes("items_type_name_model_key"),
      !idx.includes("items_type_name_model_key")
        ? "the (type, name, model) unique index is missing — duplicates can be created"
        : "",
    ],
  ];

  console.log(`schema: ${(await q("select current_schema() as s"))[0].s}\n`);
  let missing = 0;
  for (const [name, ok, note] of checks) {
    if (!ok) missing += 1;
    console.log(`  ${ok ? "OK     " : "MISSING"}  ${name}${note ? `  — ${note}` : ""}`);
  }
  console.log(
    missing === 0
      ? "\nUp to date."
      : `\n${missing} migration(s) still to apply — see supabase/README.md for the order.`,
  );
  process.exitCode = missing === 0 ? 0 : 1;
} catch (e) {
  // Neon's serverless endpoint drops connections with an empty-message error
  // often enough that `FAILED:` on its own was a regular and undiagnosable
  // sight. Fall back through the fields that are actually populated, and say
  // outright that a retry is the fix.
  const why = e.message || e.code || e.constructor?.name || String(e);
  console.error(`FAILED: ${why}`);
  if (!e.message) {
    console.error("(empty error — usually a dropped Neon connection; just run it again)");
  }
  process.exitCode = 2;
} finally {
  await pool.end();
}

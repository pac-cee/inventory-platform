import pg from "pg";
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
(async () => {
  const idx = await p.query(
    `select indexname from pg_indexes
     where tablename in ('transaction_products','corporate_transactions','stock_movements','items','item_stock')
       and (indexname like '%perf%'
            or indexname like 'transaction_products_transaction%'
            or indexname like 'corporate_transactions_location%'
            or indexname like 'items_name%' or indexname like 'items_sku%'
            or indexname like 'stock_movements_%' or indexname like 'item_stock_location%')
     order by 1`,
  );
  console.log("NEW indexes present:");
  idx.rows.forEach((r) => console.log("  " + r.indexname));
  const c = await p.query("select count(*)::int as n from corporate_transactions");
  console.log("corporate_transactions rows:", c.rows[0].n);
  await p.end();
})().catch((e) => {
  console.error("DB ERR:", e.message);
  process.exit(1);
});

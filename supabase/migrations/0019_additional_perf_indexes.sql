-- =============================================================================
-- 0019_additional_perf_indexes.sql
-- Additional indexes to fix N+1 and join performance (k6 baseline p95 7.35s)
-- Only the `public` schema exists in prod — no `test` schema.
-- =============================================================================

-- transaction_products: N+1 correlated subquery in TX_PRODUCTS (payments.ts:17-19)
-- The query does: SELECT ..., (SELECT json_agg FROM transaction_products WHERE transaction_id = t.id) ...
-- Need index on transaction_id for fast lookup per parent row.
create index if not exists transaction_products_transaction_id_idx
  on public.transaction_products (transaction_id);

-- corporate_transactions: join on location_id (payments.ts:250) - no index exists
create index if not exists corporate_transactions_location_idx
  on public.corporate_transactions (location_id);

-- composite for common filter patterns: user_id + status + created_at
create index if not exists corporate_transactions_user_status_created_idx
  on public.corporate_transactions (user_id, status, created_at desc);

-- items: ILIKE search on name/sku (items.ts:31-34) - btree helps prefix/equality
create index if not exists items_name_idx on public.items (name);
create index if not exists items_sku_idx on public.items (sku);

-- stock_movements: common filter combinations (movements.ts:42-45)
create index if not exists stock_movements_item_location_idx
  on public.stock_movements (item_id, location_id, created_at desc);

create index if not exists stock_movements_user_item_idx
  on public.stock_movements (user_id, item_id, created_at desc);

-- item_stock: queries often filter by location only
create index if not exists item_stock_location_idx on public.item_stock (location_id);

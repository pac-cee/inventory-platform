-- =============================================================================
-- 0018_perf_indexes_and_is_stocked.sql
-- =============================================================================

-- GET /payments/transactions and /notifications order by created_at desc.
create index corporate_transactions_created_at_idx
  on public.corporate_transactions (created_at desc);

create index corporate_transactions_created_at_idx
  on test.corporate_transactions (created_at desc);

-- GET /payments/budgets and resolve both do a point lookup on (year, month).
create index monthly_budgets_year_month_idx
  on public.monthly_budgets (year, month);

create index monthly_budgets_year_month_idx
  on test.monthly_budgets (year, month);

-- Replaces the runtime stock_movements scan in GET /payments/transactions.
-- Set to true by the resolve endpoint after all stock movements are inserted.
alter table public.corporate_transactions
  add column is_stocked boolean not null default false;

alter table test.corporate_transactions
  add column is_stocked boolean not null default false;

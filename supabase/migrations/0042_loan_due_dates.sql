-- =============================================================================
-- 0042_loan_due_dates.sql
-- =============================================================================
-- When a person takes equipment they can say how long they will use it, so the
-- app knows when it should be back (and can flag it when it is not).
--
-- The movement ledger is append-only and carries a stock trigger, so the date is
-- NOT a column on it. It lives here, one row per take that has a date. Extending
-- a date updates this row (keeping the original), never the ledger. A take with
-- no row simply has no fixed return date.
--
-- Additive and re-runnable; no existing rows change.
-- =============================================================================

create table if not exists public.loan_due_dates (
  movement_id                 uuid primary key references public.stock_movements(id) on delete cascade,
  expected_return_at          timestamptz not null,
  original_expected_return_at timestamptz not null,
  set_by                      uuid references public.users(id),
  updated_at                  timestamptz not null default now()
);

-- "What is due soon / overdue" scans by date.
create index if not exists loan_due_dates_due_idx on public.loan_due_dates (expected_return_at);

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute $sql$
    create table if not exists test.loan_due_dates (
      movement_id                 uuid primary key references test.stock_movements(id) on delete cascade,
      expected_return_at          timestamptz not null,
      original_expected_return_at timestamptz not null,
      set_by                      uuid references test.users(id),
      updated_at                  timestamptz not null default now()
    )
  $sql$;
  execute 'create index if not exists loan_due_dates_due_idx on test.loan_due_dates (expected_return_at)';
end;
$do$;

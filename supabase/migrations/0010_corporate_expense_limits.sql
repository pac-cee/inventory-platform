-- =============================================================================
-- 0010_corporate_expense_limits.sql
-- =============================================================================
-- Extends public.profiles with columns for corporate expense limits:
--   * has_payment_permission  — whether the user is allowed to initiate payments.
--   * fallback_role          — fallback role (e.g. 'cashier', default 'none')
--   * daily_limit            — maximum total spend allowed per calendar day.
--   * monthly_limit          — maximum total spend allowed per calendar month.
--   * per_transaction_limit  — maximum spend allowed per single payment request.
--
-- Idempotent: safe to re-run. Updates `public` and `test` if it exists.
-- =============================================================================

-- ============================ public (prod) ============================

alter table public.profiles
  add column if not exists has_payment_permission boolean not null default false;

alter table public.profiles
  add column if not exists fallback_role text not null default 'none';

alter table public.profiles drop constraint if exists profiles_fallback_role_check;
alter table public.profiles
  add constraint profiles_fallback_role_check check (fallback_role in ('cashier', 'none'));

alter table public.profiles
  add column if not exists daily_limit numeric not null default 0.00 check (daily_limit >= 0);

alter table public.profiles
  add column if not exists monthly_limit numeric not null default 0.00 check (monthly_limit >= 0);

alter table public.profiles
  add column if not exists per_transaction_limit numeric not null default 0.00 check (per_transaction_limit >= 0);


-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute 'alter table test.profiles add column if not exists has_payment_permission boolean not null default false';
  execute 'alter table test.profiles add column if not exists fallback_role text not null default ''none''';
  execute 'alter table test.profiles drop constraint if exists profiles_fallback_role_check';
  execute 'alter table test.profiles add constraint profiles_fallback_role_check check (fallback_role in (''cashier'', ''none''))';
  execute 'alter table test.profiles add column if not exists daily_limit numeric not null default 0.00 check (daily_limit >= 0)';
  execute 'alter table test.profiles add column if not exists monthly_limit numeric not null default 0.00 check (monthly_limit >= 0)';
  execute 'alter table test.profiles add column if not exists per_transaction_limit numeric not null default 0.00 check (per_transaction_limit >= 0)';
end
$do$;

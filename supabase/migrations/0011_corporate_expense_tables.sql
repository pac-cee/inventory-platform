-- =============================================================================
-- 0011_corporate_expense_tables.sql
-- =============================================================================
-- Creates public.corporate_transactions and public.transaction_products tables:
--   * corporate_transactions — tracks status, recipient, amount, momo ref, base64 receipt, and location.
--   * transaction_products   — tracks product name, quantity, price, and description for a transaction.
--
-- Idempotent: safe to re-run. Updates `public` and `test` if it exists.
-- =============================================================================

-- ============================ public (prod) ============================

create table if not exists public.corporate_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_phone text not null,
  amount numeric not null check (amount >= 0),
  status text not null default 'pending',
  momo_ref uuid,
  receipt_base64 text,
  location_id uuid references public.locations(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint corporate_transactions_status_check check (status in ('pending', 'processing', 'completed', 'failed'))
);

create table if not exists public.transaction_products (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.corporate_transactions(id) on delete cascade,
  name text not null,
  description text,
  quantity integer not null check (quantity > 0),
  price numeric not null check (price >= 0)
);

-- Index for performance
create index if not exists corporate_transactions_user_idx on public.corporate_transactions(user_id, created_at desc);

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  create table if not exists test.corporate_transactions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references test.profiles(id) on delete cascade,
    recipient_phone text not null,
    amount numeric not null check (amount >= 0),
    status text not null default 'pending',
    momo_ref uuid,
    receipt_base64 text,
    location_id uuid references test.locations(id) on delete restrict,
    created_at timestamptz not null default now(),
    constraint corporate_transactions_status_check check (status in ('pending', 'processing', 'completed', 'failed'))
  );

  create table if not exists test.transaction_products (
    id uuid primary key default gen_random_uuid(),
    transaction_id uuid not null references test.corporate_transactions(id) on delete cascade,
    name text not null,
    description text,
    quantity integer not null check (quantity > 0),
    price numeric not null check (price >= 0)
  );

  create index if not exists corporate_transactions_user_idx on test.corporate_transactions(user_id, created_at desc);
end
$do$;

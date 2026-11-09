-- =============================================================================
-- 0012_corporate_expense_rls.sql
-- =============================================================================
-- Configures Row Level Security (RLS) for the new corporate expense tables:
--   * public.is_admin_or_cashier()  — helper to verify admin or cashier fallback status.
--   * RLS policies for corporate_transactions and transaction_products.
--
-- Idempotent: safe to re-run. Updates `public` and `test` if it exists.
-- =============================================================================

-- ============================ public (prod) ============================

-- Helper: is the current user an admin or a cashier? SECURITY DEFINER so its internal read
-- bypasses RLS (avoids recursion).
create or replace function public.is_admin_or_cashier()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and (role = 'admin' or fallback_role = 'cashier')
  );
$$;

-- Enable RLS on new tables
alter table public.corporate_transactions enable row level security;
alter table public.transaction_products   enable row level security;

-- Policies for corporate_transactions
drop policy if exists "transactions_select" on public.corporate_transactions;
create policy "transactions_select" on public.corporate_transactions
  for select using (auth.uid() = user_id or public.is_admin_or_cashier());

drop policy if exists "transactions_insert" on public.corporate_transactions;
create policy "transactions_insert" on public.corporate_transactions
  for insert with check (
    auth.uid() = user_id 
    and exists (
      select 1 from public.profiles 
      where id = auth.uid() and has_payment_permission = true
    )
  );

drop policy if exists "transactions_update" on public.corporate_transactions;
create policy "transactions_update" on public.corporate_transactions
  for update using (public.is_admin_or_cashier());

-- Policies for transaction_products
drop policy if exists "products_select" on public.transaction_products;
create policy "products_select" on public.transaction_products
  for select using (
    exists (
      select 1 from public.corporate_transactions t 
      where t.id = transaction_id
    )
  );

drop policy if exists "products_insert" on public.transaction_products;
create policy "products_insert" on public.transaction_products
  for insert with check (
    exists (
      select 1 from public.corporate_transactions t 
      where t.id = transaction_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "products_all_admin" on public.transaction_products;
create policy "products_all_admin" on public.transaction_products
  for all using (public.is_admin_or_cashier());


-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  -- Create test version of helper function
  execute $fn$
    create or replace function test.is_admin_or_cashier()
    returns boolean
    language sql
    security definer
    set search_path = test
    stable
    as $body$
      select exists (
        select 1 from test.profiles where id = auth.uid() and (role = 'admin' or fallback_role = 'cashier')
      );
    $body$
  $fn$;

  execute 'alter table test.corporate_transactions enable row level security';
  execute 'alter table test.transaction_products   enable row level security';

  -- Policies for test.corporate_transactions
  execute 'drop policy if exists "transactions_select" on test.corporate_transactions';
  execute 'create policy "transactions_select" on test.corporate_transactions for select using (auth.uid() = user_id or test.is_admin_or_cashier())';

  execute 'drop policy if exists "transactions_insert" on test.corporate_transactions';
  execute 'create policy "transactions_insert" on test.corporate_transactions for insert with check (auth.uid() = user_id and exists (select 1 from test.profiles where id = auth.uid() and has_payment_permission = true))';

  execute 'drop policy if exists "transactions_update" on test.corporate_transactions';
  execute 'create policy "transactions_update" on test.corporate_transactions for update using (test.is_admin_or_cashier())';

  -- Policies for test.transaction_products
  execute 'drop policy if exists "products_select" on test.transaction_products';
  execute 'create policy "products_select" on test.transaction_products for select using (exists (select 1 from test.corporate_transactions t where t.id = transaction_id))';

  execute 'drop policy if exists "products_insert" on test.transaction_products';
  execute 'create policy "products_insert" on test.transaction_products for insert with check (exists (select 1 from test.corporate_transactions t where t.id = transaction_id and t.user_id = auth.uid()))';

  execute 'drop policy if exists "products_all_admin" on test.transaction_products';
  execute 'create policy "products_all_admin" on test.transaction_products for all using (test.is_admin_or_cashier())';
end
$do$;

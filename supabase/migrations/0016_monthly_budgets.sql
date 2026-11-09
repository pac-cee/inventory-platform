-- =============================================================================
-- 0016_monthly_budgets.sql
-- =============================================================================
-- Creates public.monthly_budgets table and adds budget mapping to corporate_transactions.
-- =============================================================================

-- ============================ public (prod) ============================

create table if not exists public.monthly_budgets (
    id uuid primary key default gen_random_uuid (),
    year int not null,
    month int not null check (month between 1 and 12),
    allocated_amount numeric not null check (allocated_amount >= 0),
    remaining_amount numeric not null check (remaining_amount >= 0),
    created_at timestamptz not null default now (),
    updated_at timestamptz not null default now (),
    constraint unique_year_month unique (year, month)
);

alter table public.corporate_transactions
add column if not exists budget_id uuid references public.monthly_budgets (id) on delete set null;

-- Enable RLS
alter table public.monthly_budgets enable row level security;

drop policy if exists "budgets_select" on public.monthly_budgets;

create policy "budgets_select" on public.monthly_budgets for
select using (
        auth.role () = 'authenticated'
    );

drop policy if exists "budgets_all" on public.monthly_budgets;

create policy "budgets_all" on public.monthly_budgets for all using (public.is_admin_or_cashier ());

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  create table if not exists test.monthly_budgets (
    id uuid primary key default gen_random_uuid(),
    year int not null,
    month int not null check (month between 1 and 12),
    allocated_amount numeric not null check (allocated_amount >= 0),
    remaining_amount numeric not null check (remaining_amount >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint unique_year_month_test unique (year, month)
  );

  alter table test.corporate_transactions
  add column if not exists budget_id uuid references test.monthly_budgets (id) on delete set null;

  alter table test.monthly_budgets enable row level security;

  drop policy if exists "budgets_select" on test.monthly_budgets;

  create policy "budgets_select" on test.monthly_budgets for
  select using (
          auth.role () = 'authenticated'
      );

  drop policy if exists "budgets_all" on test.monthly_budgets;

  create policy "budgets_all" on test.monthly_budgets for all using (
      exists (
          select 1
          from test.profiles
          where
              id = auth.uid ()
              and (
                  role = 'admin'
                  or fallback_role = 'cashier'
              )
      )
  );

end $do$;

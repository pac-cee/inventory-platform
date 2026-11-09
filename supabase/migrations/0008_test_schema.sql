-- =============================================================================
-- 0008_test_schema.sql  —  "test" environment data, same Supabase project
-- =============================================================================
-- Creates a `test` schema that MIRRORS `public` (your prod data) so test and
-- prod can share ONE Supabase project while keeping their tables isolated.
--
--   prod  -> API runs with DB_SCHEMA=public  (the existing data, unchanged)
--   test  -> API runs with DB_SCHEMA=test    (this schema)
--
-- Auth (auth.users) is project-wide and CANNOT be split without a second
-- project, so both environments share the same login accounts. Each schema
-- keeps its OWN profiles row per user (role/blocked/etc. are independent).
--
-- This file reproduces the FINAL state of migrations 0001-0007 in `test`, then
-- copies the current prod data in as an initial snapshot. After that the two
-- diverge — writing in test never touches prod and vice-versa.
--
-- HOW TO APPLY (pick one):
--   * Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   * Or, if the project is linked to the CLI with the DB password:
--       supabase db execute --file supabase/migrations/0008_test_schema.sql
--
-- AFTER APPLYING (required, one-time): expose the schema to the Data API:
--   Dashboard -> Project Settings -> API -> "Exposed schemas" -> add `test`.
--   (PostgREST will 404 every test query until `test` is in that list.)
--
-- Idempotent: safe to re-run (uses IF NOT EXISTS / OR REPLACE / ON CONFLICT).
-- =============================================================================

create schema if not exists test;

-- Expose to the Data API roles (RLS below still gates every row).
grant usage on schema test to anon, authenticated, service_role;
grant all on all tables    in schema test to anon, authenticated, service_role;
grant all on all routines  in schema test to anon, authenticated, service_role;
grant all on all sequences in schema test to anon, authenticated, service_role;
alter default privileges in schema test grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema test grant all on routines  to anon, authenticated, service_role;
alter default privileges in schema test grant all on sequences to anon, authenticated, service_role;

-- =========================================================================
-- Tables (final shape after 0001-0007)
-- =========================================================================
create table if not exists test.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  blocked boolean not null default false
);

create table if not exists test.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists test.items (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists test.item_stock (
  item_id uuid not null references test.items(id) on delete cascade,
  location_id uuid not null references test.locations(id) on delete restrict,
  quantity integer not null default 0 check (quantity >= 0),
  capacity integer not null,
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id)
);

create table if not exists test.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references test.items(id) on delete cascade,
  location_id uuid not null references test.locations(id),
  user_id uuid not null references auth.users(id),
  delta integer not null check (delta <> 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_user_idx on test.stock_movements (user_id, created_at desc);
create index if not exists stock_movements_item_idx on test.stock_movements (item_id, created_at desc);

-- =========================================================================
-- Functions (schema-qualified to test.*)
-- =========================================================================

-- is the current user an admin in the TEST schema?
create or replace function test.is_admin()
returns boolean
language sql
security definer
set search_path = test
stable
as $$
  select exists (
    select 1 from test.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Populate test.profiles for new auth users. Wrapped so a failure here can
-- NEVER abort an auth signup (prod must not depend on the test schema).
create or replace function test.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = test
as $$
begin
  insert into test.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;

-- Keep test.item_stock in sync; bound 0..capacity (final logic from 0007).
create or replace function test.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = test
as $$
declare
  current_qty integer;
  cap integer;
  new_qty integer;
begin
  select quantity, capacity into current_qty, cap
    from test.item_stock
   where item_id = new.item_id and location_id = new.location_id;

  if not found then
    if new.delta < 0 then
      raise exception 'Not enough stock to take.' using errcode = '23514';
    end if;
    insert into test.item_stock (item_id, location_id, quantity, capacity, updated_at)
    values (new.item_id, new.location_id, new.delta, new.delta, now());
    return new;
  end if;

  new_qty := current_qty + new.delta;

  if new_qty < 0 then
    raise exception 'Not enough stock: only % available to take.', current_qty
      using errcode = '23514';
  end if;

  if new_qty > cap then
    raise exception 'Cannot return more than the initial stock (% max, % currently out).',
      cap, cap - current_qty using errcode = '23514';
  end if;

  update test.item_stock
     set quantity = new_qty, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  return new;
end;
$$;

create or replace function test.enforce_role_change_is_admin()
returns trigger
language plpgsql
security definer
set search_path = test
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not test.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end;
$$;

create or replace function test.enforce_block_change_is_admin()
returns trigger
language plpgsql
security definer
set search_path = test
as $$
begin
  if new.blocked is distinct from old.blocked
     and auth.uid() is not null
     and not test.is_admin() then
    raise exception 'Only admins can block or unblock users';
  end if;
  return new;
end;
$$;

-- =========================================================================
-- Triggers
-- =========================================================================
-- A SECOND trigger on the shared auth.users that mirrors signups into test.
drop trigger if exists on_auth_user_created_test on auth.users;
create trigger on_auth_user_created_test
  after insert on auth.users
  for each row execute function test.handle_new_user();

drop trigger if exists on_stock_movement_insert on test.stock_movements;
create trigger on_stock_movement_insert
  after insert on test.stock_movements
  for each row execute function test.apply_stock_movement();

drop trigger if exists profiles_enforce_role_change on test.profiles;
create trigger profiles_enforce_role_change
  before update on test.profiles
  for each row execute function test.enforce_role_change_is_admin();

drop trigger if exists profiles_enforce_block_change on test.profiles;
create trigger profiles_enforce_block_change
  before update on test.profiles
  for each row execute function test.enforce_block_change_is_admin();

-- =========================================================================
-- Row Level Security (mirrors public, referencing test.*)
-- =========================================================================
alter table test.profiles        enable row level security;
alter table test.locations       enable row level security;
alter table test.items           enable row level security;
alter table test.item_stock      enable row level security;
alter table test.stock_movements enable row level security;

drop policy if exists "profiles_read_all"     on test.profiles;
drop policy if exists "profiles_update_self"   on test.profiles;
drop policy if exists "profiles_update_admin"  on test.profiles;
create policy "profiles_read_all"    on test.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_update_self" on test.profiles
  for update using (auth.uid() = id);
create policy "profiles_update_admin" on test.profiles
  for update using (test.is_admin());

drop policy if exists "locations_read"  on test.locations;
drop policy if exists "locations_write" on test.locations;
create policy "locations_read"  on test.locations for select using (auth.role() = 'authenticated');
create policy "locations_write" on test.locations for all using (
  exists (select 1 from test.profiles where id = auth.uid() and role = 'admin')
);

drop policy if exists "items_read"  on test.items;
drop policy if exists "items_write" on test.items;
create policy "items_read"  on test.items for select using (auth.role() = 'authenticated');
create policy "items_write" on test.items for all using (
  exists (select 1 from test.profiles where id = auth.uid() and role = 'admin')
);

drop policy if exists "item_stock_read" on test.item_stock;
create policy "item_stock_read" on test.item_stock for select using (auth.role() = 'authenticated');

drop policy if exists "movements_read"   on test.stock_movements;
drop policy if exists "movements_insert" on test.stock_movements;
create policy "movements_read"   on test.stock_movements
  for select using (auth.role() = 'authenticated');
create policy "movements_insert" on test.stock_movements
  for insert with check (auth.uid() = user_id);

-- =========================================================================
-- Initial data snapshot: copy current prod (public) data into test.
-- Comment out this whole block if you'd rather start test EMPTY.
-- The movement trigger is disabled during the copy so item_stock (copied
-- verbatim) is not recomputed.
-- =========================================================================
insert into test.profiles (id, full_name, role, created_at, blocked)
select id, full_name, role, created_at, blocked from public.profiles
on conflict (id) do nothing;

insert into test.locations (id, name, created_at)
select id, name, created_at from public.locations
on conflict (id) do nothing;

insert into test.items (id, sku, name, description, created_at)
select id, sku, name, description, created_at from public.items
on conflict (id) do nothing;

insert into test.item_stock (item_id, location_id, quantity, capacity, updated_at)
select item_id, location_id, quantity, capacity, updated_at from public.item_stock
on conflict (item_id, location_id) do nothing;

alter table test.stock_movements disable trigger on_stock_movement_insert;
insert into test.stock_movements (id, item_id, location_id, user_id, delta, note, created_at)
select id, item_id, location_id, user_id, delta, note, created_at from public.stock_movements
on conflict (id) do nothing;
alter table test.stock_movements enable trigger on_stock_movement_insert;

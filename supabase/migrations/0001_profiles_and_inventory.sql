-- Initial schema: profiles + inventory + stock movements.
-- Auth is handled by Supabase's built-in auth.users table.

-- =========================================================================
-- profiles: one row per auth.users, with display name + role
-- =========================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- locations: physical places stock lives
-- =========================================================================
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- items: catalog. Quantity is per (item, location) — see stock table.
-- =========================================================================
create table public.items (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.item_stock (
  item_id uuid not null references public.items(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id)
);

-- =========================================================================
-- stock_movements: append-only log of every check-out / check-in.
-- The dashboard derives "who took what" from this table.
-- =========================================================================
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  user_id uuid not null references auth.users(id),
  delta integer not null check (delta <> 0),  -- negative = checked out, positive = checked in
  note text,
  created_at timestamptz not null default now()
);

create index stock_movements_user_idx on public.stock_movements (user_id, created_at desc);
create index stock_movements_item_idx on public.stock_movements (item_id, created_at desc);

-- Keep item_stock in sync whenever a movement is recorded.
create function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
begin
  insert into public.item_stock (item_id, location_id, quantity, updated_at)
  values (new.item_id, new.location_id, new.delta, now())
  on conflict (item_id, location_id) do update
    set quantity   = public.item_stock.quantity + excluded.quantity,
        updated_at = now();
  return new;
end;
$$;

create trigger on_stock_movement_insert
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.profiles        enable row level security;
alter table public.locations       enable row level security;
alter table public.items           enable row level security;
alter table public.item_stock      enable row level security;
alter table public.stock_movements enable row level security;

-- Profiles: everyone can read all profiles (so we can show names in the activity log);
-- a user can only update their own profile.
create policy "profiles_read_all"    on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id);

-- Locations & items & stock: any signed-in user can read; writes are admin-only.
create policy "locations_read"  on public.locations  for select using (auth.role() = 'authenticated');
create policy "locations_write" on public.locations  for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

create policy "items_read"  on public.items  for select using (auth.role() = 'authenticated');
create policy "items_write" on public.items  for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

create policy "item_stock_read" on public.item_stock for select using (auth.role() = 'authenticated');
-- item_stock is only written by the trigger above, so no write policy needed.

-- Movements: any signed-in user can read the log and insert their own movements.
create policy "movements_read"   on public.stock_movements
  for select using (auth.role() = 'authenticated');
create policy "movements_insert" on public.stock_movements
  for insert with check (auth.uid() = user_id);

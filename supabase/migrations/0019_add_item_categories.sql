-- 0019 — Item categories (admin-managed list + optional category per item).
-- Idempotent: safe to run on an existing database.

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table items
  add column if not exists category_id uuid references categories(id) on delete set null;

create index if not exists items_category_idx on items (category_id);

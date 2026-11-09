-- =============================================================================
-- Bring an existing database up to date: migrations 0027 - 0033, in order.
-- =============================================================================
-- Paste this whole file into the Neon SQL editor (or psql) for the target
-- environment and run it once.
--
-- Every statement is idempotent, so running it against a database that already
-- has some (or all) of these is a no-op. Order matters and is preserved here:
--   * 0030 must follow 0029  - 0029 swaps the global unique constraint on
--     locations.name for a partial index, 0030 replaces THAT index. Reversed,
--     the old constraint survives and sub-location names keep clashing.
--   * 0031 must land before the API that writes 'reassign' rows starts, or a
--     check-in at a different location than the check-out fails the reason
--     constraint.
--   * 0033 must land before the API that requires a damage reason starts. It is
--     additive, but the damage/repair routes write `recommendation` and
--     `resolves` on every fault, so without it marking anything damaged fails.
--
-- Safe to run inside a single transaction. Nothing here drops a table or a
-- column; the only DROPs are of constraints/indexes that are re-created
-- immediately, and 0028 is a bounded UPDATE.
--
-- Generated from supabase/migrations/ - keep in step if those change.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0027_item_packages_and_transfer.sql
-- Package items + the 'transfer' ledger reason
-- -----------------------------------------------------------------------------
alter table items add column if not exists package_label text;

-- 2. Relocate/transfer: allow moving an item's stock between locations (e.g. from
--    a room into a sub-location created later). Recorded as two 'transfer' ledger
--    entries. Add the reason to the allowed set.
alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('take','return','initial','finish','destroyed','lost','adjust','undo','repair','transfer'));


-- -----------------------------------------------------------------------------
-- 0028_heal_stock_capacity.sql
-- Heal totals that are below the units present
-- -----------------------------------------------------------------------------
update item_stock
   set capacity = quantity + damaged,
       updated_at = now()
 where capacity < quantity + damaged;


-- -----------------------------------------------------------------------------
-- 0029_location_archive.sql
-- Archive locations instead of failing to delete them
-- -----------------------------------------------------------------------------
alter table locations add column if not exists archived_at timestamptz;

-- Name uniqueness now applies only to live locations, so a name freed by
-- archiving can be used again.
alter table locations drop constraint if exists locations_name_key;
create unique index if not exists locations_name_active_key
  on locations (name) where archived_at is null;

create index if not exists locations_archived_idx on locations (archived_at);


-- -----------------------------------------------------------------------------
-- 0030_location_name_per_parent.sql
-- Location names unique per parent, not globally
-- -----------------------------------------------------------------------------
alter table locations drop constraint if exists locations_name_key;
drop index if exists locations_name_active_key;

create unique index if not exists locations_name_per_parent_key
  on locations (parent_id, name)
  where archived_at is null and parent_id is not null;

create unique index if not exists locations_name_top_level_key
  on locations (name)
  where archived_at is null and parent_id is null;


-- -----------------------------------------------------------------------------
-- 0031_reassign_reason.sql
-- The 'reassign' ledger reason
-- -----------------------------------------------------------------------------
alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('take','return','initial','finish','destroyed','lost','adjust','undo','repair','transfer','reassign'));


-- -----------------------------------------------------------------------------
-- 0032_password_resets_and_low_stock_alerts.sql
-- Tables that only ever existed in schema.sql
-- -----------------------------------------------------------------------------
create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,      -- sha256(raw token)
  expires_at timestamptz not null,
  used_at timestamptz,                  -- null until consumed (single-use)
  created_at timestamptz not null default now()
);
create index if not exists password_resets_user_idx on password_resets (user_id);

-- E4: which (item, location) pairs have already been alerted on, so admins get
-- one email per low-stock event instead of one per scan.
create table if not exists low_stock_alerts (
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  last_alerted_at timestamptz not null default now(),
  primary key (item_id, location_id)
);


-- -----------------------------------------------------------------------------
-- 0033_condition_report.sql
-- Grouping + fault detail for the condition report
-- -----------------------------------------------------------------------------
alter table items add column if not exists category text;
create index if not exists items_category_idx on items (category);

alter table stock_movements add column if not exists recommendation text;
alter table stock_movements add column if not exists resolves uuid references stock_movements(id);

create index if not exists stock_movements_resolves_idx on stock_movements (resolves)
  where resolves is not null;
create index if not exists stock_movements_faults_idx
  on stock_movements (item_id, location_id)
  where reason = 'destroyed';

-- 0029_location_archive.sql
-- Make "remove location" actually work.
--
-- Deleting a location failed for almost every real one: stock_movements,
-- corporate_transactions and even fully-emptied item_stock rows all hold a
-- foreign key to it, so Postgres raised a constraint error that surfaced in the
-- UI as an opaque server-render failure. The ledger is append-only, so a used
-- location can't be erased without rewriting history — it gets archived instead.
--
-- Archived locations are hidden from GET /locations (and therefore from every
-- picker, list and report filter) but stay resolvable for historical rows.
--
-- Idempotent: safe to re-run.

alter table locations add column if not exists archived_at timestamptz;

-- Name uniqueness now applies only to live locations, so a name freed by
-- archiving can be used again.
alter table locations drop constraint if exists locations_name_key;
create unique index if not exists locations_name_active_key
  on locations (name) where archived_at is null;

create index if not exists locations_archived_idx on locations (archived_at);

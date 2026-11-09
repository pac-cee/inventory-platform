-- 0030_location_name_per_parent.sql
-- Location names only have to be unique among their siblings.
--
-- The original schema declared `name text not null unique`, which is global: a
-- "Shelf 3" anywhere in the tree blocked a "Shelf 3" under any other room, and
-- the failure surfaced as raw Postgres text ("duplicate key value violates
-- unique constraint ..."). That is wrong for a hierarchy — sibling names are
-- what must be distinguishable, and the UI already renders the full path
-- ("House > Level-1 > Shelf 3") to tell same-named locations apart.
--
-- Two partial indexes because SQL treats NULLs as distinct: without the second
-- one, top-level locations (parent_id is null) would have no uniqueness at all.
-- Both exclude archived rows, so a removed location frees its name (0029).
--
-- This only LOOSENS the rule, so it cannot fail on existing data.
-- Idempotent: safe to re-run.

alter table locations drop constraint if exists locations_name_key;
drop index if exists locations_name_active_key;

create unique index if not exists locations_name_per_parent_key
  on locations (parent_id, name)
  where archived_at is null and parent_id is not null;

create unique index if not exists locations_name_top_level_key
  on locations (name)
  where archived_at is null and parent_id is null;

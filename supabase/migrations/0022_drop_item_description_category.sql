-- 0022: simplify items to name + SKU + specification.
-- Drops the item description and category (and the categories table). Items are
-- now identified by name + SKU; the free-text specification differentiates
-- variants (same name + different SKU/spec = different items).
-- Idempotent: safe to run on an existing database.

alter table items drop column if exists category_id;
alter table items drop column if exists description;

drop index if exists items_category_idx;
drop table if exists categories cascade;

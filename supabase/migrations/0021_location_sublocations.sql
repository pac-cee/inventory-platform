-- 0021: sub-locations
-- A location may nest one level under a parent "category" location.
-- parent_id NULL  -> top-level location (acts as a category)
-- parent_id set   -> sub-location of that top-level location
-- Deleting a parent promotes its children to top-level (on delete set null).
-- Two levels only: enforced in the API (a parent must itself be top-level).

alter table locations
  add column if not exists parent_id uuid references locations(id) on delete set null;

create index if not exists locations_parent_idx on locations (parent_id);

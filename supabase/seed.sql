-- Demo seed data so the dashboard isn't empty.
-- Inserts a few locations, catalog items, and per-location stock. Runs as the
-- migration (superuser) role, so RLS is bypassed and no admin user is required.
-- Idempotent: safe to re-run. Delete this file before going to production.

-- Locations (name is unique) -------------------------------------------------
insert into public.locations (name) values
  ('Stockroom'),
  ('Cold Storage'),
  ('Lab A')
on conflict (name) do nothing;

-- Catalog items (sku is unique) ----------------------------------------------
insert into public.items (sku, name, description) values
  ('WID-001', 'Widget A',     'Standard widget, blue'),
  ('GAD-002', 'Gadget B',     'Handheld gadget'),
  ('PRT-003', 'Part C',       'Replacement part'),
  ('CMP-004', 'Component X',  'Bulk electronic component'),
  ('PRD-005', 'Product Z',    'Finished product')
on conflict (sku) do nothing;

-- Stock levels per (item, location). Written directly to item_stock (the
-- movement trigger only fires on stock_movements inserts, so this won't double
-- count). Mix of healthy / low / out so every status badge is exercised:
--   Widget A    -> 42  (in stock)
--   Gadget B    ->  8  (low, threshold is 10)
--   Part C      ->  0 stock rows (out of stock)
--   Component X -> 150 (in stock)
--   Product Z   ->  3  (low)
insert into public.item_stock (item_id, location_id, quantity, capacity)
select i.id, l.id, v.quantity, v.quantity
from (values
  ('WID-001', 'Stockroom',    42),
  ('GAD-002', 'Stockroom',     8),
  ('CMP-004', 'Stockroom',   120),
  ('CMP-004', 'Cold Storage',  30),
  ('PRD-005', 'Lab A',          3)
) as v(sku, location_name, quantity)
join public.items i on i.sku = v.sku
join public.locations l on l.name = v.location_name
on conflict (item_id, location_id) do nothing;

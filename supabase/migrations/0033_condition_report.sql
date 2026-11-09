-- 0033: everything the condition report needs that the ledger didn't already hold.
--
-- The report groups stock by room -> category -> item and prints, per row, the
-- quantity, a plain-English condition, the % operational and a recommendation.
-- Quantity and % operational are already derivable (capacity, damaged), and the
-- condition sentence is a tally of WHY units are damaged — which means the
-- damage reason has to be recorded, and has to be clearable when repaired.
--
-- Three additions:
--   * items.category      — the report's grouping column. Free text, not a
--                           lookup table: 0022 deliberately dropped `categories`
--                           and items are plain name + sku + specification now.
--   * stock_movements.recommendation
--                         — what to DO about a fault, captured with the fault
--                           itself so it retires when the fault is repaired.
--   * stock_movements.resolves
--                         — which fault a repair fixed. Without it, repairing 1
--                           of 3 distinct faults leaves the tally guessing which
--                           sentence to shorten.
--
-- Idempotent: safe to re-run.

alter table items add column if not exists category text;

-- The report's outer grouping, and the category picker's suggestion list.
create index if not exists items_category_idx on items (category);

alter table stock_movements add column if not exists recommendation text;

-- Self-reference: a 'repair' row points at the 'destroyed' row it clears.
-- Null for legacy repairs and for bulk repairs that predate a recorded fault —
-- the report shows any such shortfall as an unattributed bucket rather than
-- silently dropping units.
alter table stock_movements add column if not exists resolves uuid references stock_movements(id);

create index if not exists stock_movements_resolves_idx on stock_movements (resolves)
  where resolves is not null;

-- Faults are looked up per (item, location) whenever the damage/repair UI opens,
-- filtered to reason = 'destroyed'.
create index if not exists stock_movements_faults_idx
  on stock_movements (item_id, location_id)
  where reason = 'destroyed';

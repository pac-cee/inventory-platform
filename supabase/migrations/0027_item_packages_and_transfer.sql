-- 0027_item_packages_and_transfer.sql
-- Two additive, backward-compatible changes:
--
-- 1. Package items: an item whose stock is counted in WHOLE packages, with the
--    contents deliberately NOT tracked (e.g. "5 packages of motherboards"). When
--    package_label is set, quantity is a package count and the UI shows
--    "5 <label>s" with no unit breakdown. Distinct from units_per_container
--    (which tracks units and shows "(N units)").
alter table items add column if not exists package_label text;

-- 2. Relocate/transfer: allow moving an item's stock between locations (e.g. from
--    a room into a sub-location created later). Recorded as two 'transfer' ledger
--    entries. Add the reason to the allowed set.
alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('take','return','initial','finish','destroyed','lost','adjust','undo','repair','transfer'));

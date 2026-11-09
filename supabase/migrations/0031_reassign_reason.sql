-- 0031_reassign_reason.sql
-- New ledger reason: 'reassign'.
--
-- Checking stock out leaves the source location's TOTAL untouched — the units
-- still belong to it, they're just in someone's hands. Returning them to a
-- different location therefore counted the same physical units twice: the
-- source still carried them in its total and the destination gained a total of
-- its own, so an item's grand total climbed every time something came back to
-- a different shelf.
--
-- A check-in elsewhere now also hands the total over: a capacity-only
-- 'reassign' entry at the origin (delta 0, capacity_delta negative) paired with
-- the matching capacity_delta on the 'return' at the destination. The pair
-- nets to zero, so the grand total is conserved.
--
-- It needs its own reason rather than reusing 'transfer': 'transfer' is the
-- whole-row relocate, and the per-location "who is holding what" tally has to
-- tell the two apart to stay correct.
--
-- Idempotent: safe to re-run.

alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('take','return','initial','finish','destroyed','lost','adjust','undo','repair','transfer','reassign'));

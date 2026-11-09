-- 0028_heal_stock_capacity.sql
-- One-time data correction for legacy rows where the total (capacity) was
-- under-counted — i.e. accessible + damaged exceeds the recorded total, an
-- impossible state ("Total 0 = 1 accessible"). It came from stock loaded outside
-- the normal movement flow, and it makes the stock trigger reject legitimate
-- actions (relocate, finish, lost, adjust-down) with "Total stock cannot go
-- below zero." Raise the total to at least the units physically present.
--
-- Idempotent: after running, no rows match the WHERE clause, so re-running is a
-- no-op. Rows with a valid or larger total (e.g. units checked out) are untouched.
update item_stock
   set capacity = quantity + damaged,
       updated_at = now()
 where capacity < quantity + damaged;

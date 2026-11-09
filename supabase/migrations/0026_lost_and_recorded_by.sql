-- 0026: "lost" movements + recorded_by attribution.
-- - recorded_by: who physically recorded the movement (defaults to user_id).
--   When an admin attributes damage/loss to a holder, user_id is the holder and
--   recorded_by is the admin, so only admins can undo those.
-- - 'lost' reason: like damage but the units are gone (reduces the total).
-- Idempotent.

alter table stock_movements add column if not exists recorded_by uuid references users(id);
update stock_movements set recorded_by = user_id where recorded_by is null;

alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('take','return','initial','finish','destroyed','lost','adjust','undo','repair'));

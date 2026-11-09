-- Fix stock movements so quantities actually persist — for initial stock,
-- check-outs (take) AND check-ins (return).
--
-- Two distinct bugs in the original apply_stock_movement trigger (0001):
--
-- 1. RLS: item_stock has RLS enabled with only a SELECT policy (it is meant to
--    be written exclusively by this trigger). But the function was NOT security
--    definer, so it ran as the calling `authenticated` user, whom RLS forbids
--    from writing item_stock. The write was rejected and rolled back the whole
--    movement. Seeded stock survived only because 0002 ran as superuser.
--
-- 2. Negative deltas: the function used INSERT ... ON CONFLICT DO UPDATE.
--    PostgreSQL evaluates the `quantity >= 0` CHECK against the *proposed insert
--    tuple* (the raw delta) before the conflict resolves to an UPDATE, so any
--    negative delta — i.e. every check-out — failed with a check-constraint
--    violation, even when the resulting balance was non-negative.
--
-- Fix both: make the function security definer (matching handle_new_user /
-- is_admin), and update-first so the CHECK only ever sees the final balance.
-- Over-withdrawal (balance < 0) still correctly raises 23514 -> 422 at the API.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.item_stock
     set quantity   = quantity + new.delta,
         updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;

  if not found then
    insert into public.item_stock (item_id, location_id, quantity, updated_at)
    values (new.item_id, new.location_id, new.delta, now());
  end if;

  return new;
end;
$$;

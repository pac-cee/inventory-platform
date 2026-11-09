-- Bound stock between 0 and its initial amount.
--   * Taking (check-out) can't drop a location's quantity below 0.
--   * Returning (check-in) can't push it above the amount it started with.
-- Both limits apply to everyone (admins and members) and raise a clear message
-- mapped to HTTP 422 (errcode 23514) by the API.

-- Ceiling per (item, location): the quantity it was first stocked with.
alter table public.item_stock
  add column if not exists capacity integer;

-- Backfill existing rows: their current quantity becomes the ceiling.
update public.item_stock set capacity = quantity where capacity is null;

alter table public.item_stock
  alter column capacity set not null;

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_qty integer;
  cap integer;
  new_qty integer;
begin
  select quantity, capacity into current_qty, cap
    from public.item_stock
   where item_id = new.item_id and location_id = new.location_id;

  if not found then
    -- First movement for this item+location sets the stock and its ceiling.
    if new.delta < 0 then
      raise exception 'Not enough stock to take.' using errcode = '23514';
    end if;
    insert into public.item_stock (item_id, location_id, quantity, capacity, updated_at)
    values (new.item_id, new.location_id, new.delta, new.delta, now());
    return new;
  end if;

  new_qty := current_qty + new.delta;

  if new_qty < 0 then
    raise exception 'Not enough stock: only % available to take.', current_qty
      using errcode = '23514';
  end if;

  if new_qty > cap then
    raise exception 'Cannot return more than the initial stock (% max, % currently out).',
      cap, cap - current_qty using errcode = '23514';
  end if;

  update public.item_stock
     set quantity = new_qty, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  return new;
end;
$$;

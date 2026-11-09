-- 0025: clarify the over-capacity error message.
-- The cap is per-location, not the item's total across locations, so the
-- message shouldn't say "total stock". Only the raise text changes.

create or replace function apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  current_qty integer;
  cap integer;
  current_damaged integer;
  new_qty integer;
  new_cap integer;
  new_damaged integer;
begin
  select quantity, capacity, damaged into current_qty, cap, current_damaged
    from item_stock
   where item_id = new.item_id and location_id = new.location_id;

  if not found then
    if new.delta < 0 or new.damaged_delta < 0 then
      raise exception 'Not enough stock to take.' using errcode = '23514';
    end if;
    insert into item_stock (item_id, location_id, quantity, damaged, capacity, updated_at)
    values (
      new.item_id, new.location_id, new.delta, new.damaged_delta,
      greatest(new.delta + new.damaged_delta, new.capacity_delta), now()
    );
    return new;
  end if;

  new_qty := current_qty + new.delta;
  new_cap := cap + new.capacity_delta;
  new_damaged := current_damaged + new.damaged_delta;

  if new_cap < 0 then
    raise exception 'Total stock cannot go below zero.' using errcode = '23514';
  end if;
  if new_qty < 0 then
    raise exception 'Not enough stock: only % available.', current_qty using errcode = '23514';
  end if;
  if new_damaged < 0 then
    raise exception 'Cannot repair more than is damaged (% damaged).', current_damaged using errcode = '23514';
  end if;
  if new_qty + new_damaged > new_cap then
    raise exception 'That exceeds the stock at this location (% max here).', new_cap using errcode = '23514';
  end if;

  update item_stock
     set quantity = new_qty, capacity = new_cap, damaged = new_damaged, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  return new;
end;
$$;

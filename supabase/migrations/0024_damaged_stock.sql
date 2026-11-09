-- 0024: damaged stock.
-- "Destroy" no longer reduces the total — it moves units from accessible
-- (quantity) into a `damaged` bucket. Total (capacity) is unchanged; damaged
-- units stay part of inventory. A new "repair" reason moves damaged back to
-- accessible. Idempotent.

alter table item_stock add column if not exists damaged integer not null default 0;
do $$ begin
  alter table item_stock add constraint item_stock_damaged_check check (damaged >= 0);
exception when duplicate_object then null; end $$;

alter table stock_movements add column if not exists damaged_delta integer not null default 0;

alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('take','return','initial','finish','destroyed','adjust','undo','repair'));

alter table stock_movements drop constraint if exists stock_movements_changes_something;
alter table stock_movements add constraint stock_movements_changes_something
  check (delta <> 0 or capacity_delta <> 0 or damaged_delta <> 0);

-- Stock engine: apply delta to accessible, capacity_delta to the total, and
-- damaged_delta to the damaged bucket; keep accessible + damaged <= total.
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
    raise exception 'That exceeds the total stock (% max).', new_cap using errcode = '23514';
  end if;

  update item_stock
     set quantity = new_qty, capacity = new_cap, damaged = new_damaged, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  return new;
end;
$$;

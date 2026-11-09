-- =============================================================================
-- 0009_finishable_and_consume.sql
-- =============================================================================
-- Adds permanent stock consumption ("finish" / "destroyed"), an admin stock
-- edit, and an undo, on top of the existing take/return model.
--
--   * items.finishable          — admin toggle; gates the "finish" action.
--   * stock_movements.reason     — labels each movement (take/return/initial/
--                                  finish/destroyed/adjust/undo).
--   * stock_movements.capacity_delta — how much this movement changes the
--                                  per-(item,location) ceiling (item_stock.capacity).
--   * stock_movements.reversal_of — for undo: points at the movement it reverses
--                                  (one undo per movement).
--
-- The trigger now applies BOTH delta (to quantity) and capacity_delta (to the
-- ceiling), so finish/destroyed shrink the total permanently and undo restores
-- it, while take/return (capacity_delta = 0) behave exactly as before.
--
-- HOW TO APPLY (pick one):
--   * Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   * supabase db execute --file supabase/migrations/0009_finishable_and_consume.sql
--
-- Idempotent: safe to re-run. Updates `public` always and `test` if it exists.
-- =============================================================================

-- ============================ public (prod) ============================

alter table public.items
  add column if not exists finishable boolean not null default false;

alter table public.stock_movements
  add column if not exists reason text not null default 'take';
alter table public.stock_movements
  add column if not exists capacity_delta integer not null default 0;
alter table public.stock_movements
  add column if not exists reversal_of uuid references public.stock_movements(id);

-- A movement no longer has to change quantity (an admin "adjust" may only move
-- the ceiling), but it must change something.
alter table public.stock_movements drop constraint if exists stock_movements_delta_check;
alter table public.stock_movements drop constraint if exists stock_movements_changes_something;
alter table public.stock_movements
  add constraint stock_movements_changes_something check (delta <> 0 or capacity_delta <> 0);

alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('take','return','initial','finish','destroyed','adjust','undo'));

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
  new_cap integer;
begin
  select quantity, capacity into current_qty, cap
    from public.item_stock
   where item_id = new.item_id and location_id = new.location_id;

  if not found then
    -- First movement for this item+location creates the row and its ceiling.
    if new.delta < 0 then
      raise exception 'Not enough stock to take.' using errcode = '23514';
    end if;
    insert into public.item_stock (item_id, location_id, quantity, capacity, updated_at)
    values (new.item_id, new.location_id, new.delta, greatest(new.delta, new.capacity_delta), now());
    return new;
  end if;

  new_qty := current_qty + new.delta;
  new_cap := cap + new.capacity_delta;

  if new_cap < 0 then
    raise exception 'Total stock cannot go below zero.' using errcode = '23514';
  end if;
  if new_qty < 0 then
    raise exception 'Not enough stock: only % available.', current_qty using errcode = '23514';
  end if;
  if new_qty > new_cap then
    raise exception 'That exceeds the total stock (% max).', new_cap using errcode = '23514';
  end if;

  update public.item_stock
     set quantity = new_qty, capacity = new_cap, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  return new;
end;
$$;

-- ============================ test (mirror) ============================
-- Applied only if the test schema from 0008 exists.

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute 'alter table test.items add column if not exists finishable boolean not null default false';
  execute 'alter table test.stock_movements add column if not exists reason text not null default ''take''';
  execute 'alter table test.stock_movements add column if not exists capacity_delta integer not null default 0';
  execute 'alter table test.stock_movements add column if not exists reversal_of uuid references test.stock_movements(id)';

  execute 'alter table test.stock_movements drop constraint if exists stock_movements_delta_check';
  execute 'alter table test.stock_movements drop constraint if exists stock_movements_changes_something';
  execute 'alter table test.stock_movements add constraint stock_movements_changes_something check (delta <> 0 or capacity_delta <> 0)';
  execute 'alter table test.stock_movements drop constraint if exists stock_movements_reason_check';
  execute 'alter table test.stock_movements add constraint stock_movements_reason_check check (reason in (''take'',''return'',''initial'',''finish'',''destroyed'',''adjust'',''undo''))';

  execute $fn$
    create or replace function test.apply_stock_movement()
    returns trigger
    language plpgsql
    security definer
    set search_path = test
    as $body$
    declare
      current_qty integer;
      cap integer;
      new_qty integer;
      new_cap integer;
    begin
      select quantity, capacity into current_qty, cap
        from test.item_stock
       where item_id = new.item_id and location_id = new.location_id;

      if not found then
        if new.delta < 0 then
          raise exception 'Not enough stock to take.' using errcode = '23514';
        end if;
        insert into test.item_stock (item_id, location_id, quantity, capacity, updated_at)
        values (new.item_id, new.location_id, new.delta, greatest(new.delta, new.capacity_delta), now());
        return new;
      end if;

      new_qty := current_qty + new.delta;
      new_cap := cap + new.capacity_delta;

      if new_cap < 0 then
        raise exception 'Total stock cannot go below zero.' using errcode = '23514';
      end if;
      if new_qty < 0 then
        raise exception 'Not enough stock: only % available.', current_qty using errcode = '23514';
      end if;
      if new_qty > new_cap then
        raise exception 'That exceeds the total stock (% max).', new_cap using errcode = '23514';
      end if;

      update test.item_stock
         set quantity = new_qty, capacity = new_cap, updated_at = now()
       where item_id = new.item_id and location_id = new.location_id;
      return new;
    end;
    $body$
  $fn$;
end
$do$;

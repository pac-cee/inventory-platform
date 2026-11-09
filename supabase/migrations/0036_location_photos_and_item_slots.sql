-- 0036: two things that make a location page recognisable at a glance.
--
-- 1. A picture per location and sub-location. Same two-column shape as items
--    (0034): `photo_url` links an image hosted elsewhere, `photo_data` holds an
--    upload as a data URI, and an upload wins when both are set. Kept apart for
--    the same reason as items — GET /locations returns every location, so an
--    inlined image would be paid for on every list; the bytes come one at a
--    time from GET /locations/:id/photo.
--
-- 2. A number per item within a location: `item_stock.slot_no`. Items are
--    identified globally by SKU, but on a shelf people point at "number 3", so
--    each (item, location) pair gets a small integer that is stable for as long
--    as the item stays there. Numbering restarts in every location — the same
--    item can be #2 in one room and #7 in another.
--
-- Idempotent: safe to re-run.

alter table locations add column if not exists photo_url text;
alter table locations add column if not exists photo_data text;

alter table item_stock add column if not exists slot_no integer;

-- Backfill in a stable order so re-running never renumbers anything: existing
-- rows are numbered per location by when they first arrived.
with numbered as (
  select item_id, location_id,
         row_number() over (partition by location_id order by updated_at, item_id) as n
    from item_stock
   where slot_no is null
)
update item_stock s
   set slot_no = numbered.n
  from numbered
 where s.item_id = numbered.item_id
   and s.location_id = numbered.location_id;

-- Two items in the same location can never share a number. Partial, because
-- slot_no is nullable for the instant between insert and the trigger below.
create unique index if not exists item_stock_slot_no_key
  on item_stock (location_id, slot_no) where slot_no is not null;

-- item_stock rows are written only by apply_stock_movement, so the number is
-- assigned here rather than in the API: whatever creates the row gets one.
-- The lock serialises concurrent first-arrivals into the same location, which
-- would otherwise both read the same max() and collide on the index above.
create or replace function assign_item_slot_no()
returns trigger
language plpgsql
as $$
begin
  if new.slot_no is null then
    perform pg_advisory_xact_lock(hashtext('item_stock_slot' || new.location_id::text));
    select coalesce(max(slot_no), 0) + 1 into new.slot_no
      from item_stock where location_id = new.location_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_item_stock_insert on item_stock;
create trigger on_item_stock_insert
  before insert on item_stock
  for each row execute function assign_item_slot_no();

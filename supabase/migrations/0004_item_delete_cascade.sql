-- Allow deleting an item that has movement history.
-- stock_movements.item_id originally referenced items(id) with no ON DELETE
-- action (i.e. RESTRICT), so deleting an item that had ever been moved failed.
-- item_stock already cascades; make the movement log cascade too so an admin
-- can fully remove an item.

alter table public.stock_movements
  drop constraint stock_movements_item_id_fkey,
  add constraint stock_movements_item_id_fkey
    foreign key (item_id) references public.items(id) on delete cascade;

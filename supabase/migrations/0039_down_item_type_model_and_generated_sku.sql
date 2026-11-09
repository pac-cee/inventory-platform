-- 0039_down: reverse 0039, returning `items` to its 0038 shape.
--
-- Run ONLY against a database that has 0039 applied. It is not a substitute for
-- a Neon branch: it restores the SCHEMA and the two renamed columns, but it
-- cannot restore anything the new shape carried that the old shape has nowhere
-- to put. Specifically:
--
--   * `model` is DROPPED. Any model an admin typed after the rollout is lost.
--   * The machine `sku` is DROPPED. That is safe — it is derived, and re-running
--     0039 regenerates the same values from the same types in the same order.
--   * Items created AFTER 0039 have no row in items_0039_pre_state, so they keep
--     the mechanical reversal: their type becomes `name`, their name becomes
--     `sku`. Both values survive; only the distinction is lost.
--
-- The hand-typed SKUs come back exactly, nulls included, from the pre-state
-- table 0039 wrote. Without that table this migration would have to guess, and
-- on the production catalogue guessing would blank 15 real SKUs to recover 4
-- genuinely-empty ones.

begin;

-- ---------------------------------------------------------------------------
-- 1. Refuse to run if 0039 never ran. Reversing a database that is already in
--    the 0038 shape would rename the wrong columns and scramble the catalogue.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = current_schema() and table_name = 'items' and column_name = 'type'
  ) then
    raise exception '0039 is not applied here (items.type does not exist) — nothing to reverse';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Drop what 0039 added. Dropping the `sku` COLUMN takes its unique
--    constraint and its index with it, so they need no separate statement.
-- ---------------------------------------------------------------------------
drop index if exists items_type_name_model_key;
alter table items drop column if exists sku;
alter table items drop column if exists model;

-- ---------------------------------------------------------------------------
-- 3. Undo the name backfill BEFORE the rename, while the columns still mean
--    what the pre-state table recorded. `name` currently holds either the
--    hand-typed SKU or, where that was blank, a copy of the type — possibly
--    with a ' (2)' suffix. Restoring old_sku verbatim undoes all three cases at
--    once: the copy, the suffix, and the nulls.
-- ---------------------------------------------------------------------------
alter table items alter column name drop not null;

update items i
   set name = s.old_sku
  from items_0039_pre_state s
 where s.id = i.id
   and i.name is distinct from s.old_sku;

-- ---------------------------------------------------------------------------
-- 4. Reverse the renames.
-- ---------------------------------------------------------------------------
alter table items rename column name to sku;
alter table items rename column type to name;

-- ---------------------------------------------------------------------------
-- 5. Restore the 0038 constraints and index names.
--
--    Order matters: items_name_idx currently sits on the column now called
--    `sku`, so it has to give up the name before items_type_idx can take it.
-- ---------------------------------------------------------------------------
alter index if exists items_name_idx rename to items_sku_idx;
alter index if exists items_type_idx rename to items_name_idx;

alter table items add constraint items_sku_key unique (sku);

-- ---------------------------------------------------------------------------
-- 6. transaction_products: drop the two carried fields.
-- ---------------------------------------------------------------------------
alter table transaction_products drop column if exists type;
alter table transaction_products drop column if exists model;

-- Restore the transaction builder to its 0038 form, verbatim.
create or replace function create_corporate_transaction(
  p_user_id uuid,
  p_recipient_phone text,
  p_amount numeric,
  p_location_id uuid,
  p_receipt_base64 text,
  p_products jsonb,
  p_payment_metadata jsonb default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_tx_id uuid;
  v_prod jsonb;
begin
  insert into corporate_transactions (
    user_id, recipient_phone, amount, location_id, receipt_base64, payment_metadata, status
  ) values (
    p_user_id, p_recipient_phone, p_amount, p_location_id, p_receipt_base64, p_payment_metadata, 'pending'
  )
  returning id into v_tx_id;

  for v_prod in select * from jsonb_array_elements(p_products) loop
    insert into transaction_products (
      transaction_id, name, description, sku, specification, quantity, price, item_photo_base64
    ) values (
      v_tx_id,
      (v_prod->>'name')::text,
      (v_prod->>'description')::text,
      (v_prod->>'sku')::text,
      (v_prod->>'specification')::text,
      (v_prod->>'quantity')::integer,
      (v_prod->>'price')::numeric,
      (v_prod->>'image_base64')::text
    );
  end loop;

  return v_tx_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Drop 0039's helper. The pre-state table is deliberately KEPT: it is the
--    record of what the migration did, and re-applying 0039 will not overwrite
--    it (its insert is `on conflict do nothing`), so a second round trip still
--    restores the original SKUs.
-- ---------------------------------------------------------------------------
drop function if exists item_sku_prefix(text);

commit;

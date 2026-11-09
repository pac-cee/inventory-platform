-- 0039: item type + model, and machine-assigned SKUs.
--
-- What the old columns really held:
--   items.name  was the item TYPE  ("Cable")   -> becomes items.type
--   items.sku   was the item NAME  (hand-typed) -> becomes items.name
-- and two columns are new:
--   items.model  the model, required from here on
--   items.sku    machine-assigned, `vrlt-<prefix of the type>-<seq>`
--
-- The SKU is no longer typed by a person. It is derived from the item type and
-- a running count within that type, so "Cable" yields vrlt-cbl-001,
-- vrlt-cbl-002, vrlt-cbl-003. Printed QR codes are unaffected: they encode
-- `inventory:item:<uuid>`, never the SKU.

begin;

-- ---------------------------------------------------------------------------
-- 1. Rename the two existing columns into what they actually mean.
-- ---------------------------------------------------------------------------
alter table items rename column name to type;
alter table items rename column sku to name;

-- The unique constraint was created for `sku` and followed that column onto
-- `name`. The machine SKU takes over as the unique key, so it goes; a
-- (type, name, model) uniqueness rule replaces it further down.
alter table items drop constraint if exists items_sku_key;

alter table items add column if not exists model text;
alter table items add column if not exists sku text;

-- ---------------------------------------------------------------------------
-- 2. The prefix rule, as a function so the backfill and any later repair
--    share one definition.
--
--    MUST MIRROR `typePrefix` in supabase/api/src/lib/sku.ts:
--      3+ words -> the initials             ("Hard Ware Devices" -> hwd)
--      2 words  -> 3 letters then 2         ("Filament Dryer"    -> fildr)
--      1 word   -> vowels squeezed out, a leading one kept, falling back to
--                  the plain word when that leaves under three ("Fan" -> fan)
--
--    tests/routes/item-sku.test.ts asserts the two agree — change one and that
--    test fails until you change the other.
-- ---------------------------------------------------------------------------
create or replace function item_sku_prefix(txt text) returns text as $$
  with w as (
    select array_remove(
             string_to_array(
               btrim(
                 regexp_replace(
                   translate(
                     lower(coalesce(txt, '')),
                     'áàâäãåéèêëíìîïóòôöõúùûüýÿñç',
                     'aaaaaaeeeeiiiiooooouuuuyync'
                   ),
                   '[^a-z]+', ' ', 'g')),
               ' '),
             '') as words
  )
  select case
           -- No letters at all.
           when coalesce(array_length(words, 1), 0) = 0 then 'itm'
           -- Three or more words: the initials, read as an abbreviation.
           when array_length(words, 1) >= 3 then (
             select string_agg(left(word, 1), '' order by ord)
               from unnest(words[1:5]) with ordinality as t(word, ord))
           -- Two words: three letters off the first, two off the second.
           when array_length(words, 1) = 2 then left(words[1], 3) || left(words[2], 2)
           -- One word: vowels squeezed out, a leading one kept...
           when length(sq.squeezed) >= 3 then left(sq.squeezed, 5)
           -- ...unless that leaves too little to read ("Fan" -> "fan").
           else left(words[1], 3)
         end
    from w,
         lateral (
           select case
                    when left(words[1], 1) ~ '^[aeiou]$' then left(words[1], 1)
                    else ''
                  end
                  || regexp_replace(coalesce(words[1], ''), '[aeiou]', '', 'g') as squeezed
         ) sq;
$$ language sql immutable;

-- ---------------------------------------------------------------------------
-- 3. Record the pre-backfill state so this migration can be reversed.
--
--    Without it a rollback cannot tell an item whose SKU was blank (and had its
--    type copied in as a name) from one whose SKU genuinely equalled its name.
--    On the production catalogue that is 4 rows versus 15 — guessing would
--    wrongly blank 15 real SKUs. `0039_down.sql` reads this table.
--
--    Kept after a successful rollout as the audit trail of what changed; drop
--    it by hand once you are certain you will not roll back.
-- ---------------------------------------------------------------------------
create table if not exists items_0039_pre_state (
  id uuid primary key references items(id) on delete cascade,
  -- The hand-typed SKU exactly as it was, nulls included. At this point in the
  -- migration `name` still holds it, because the rename has happened but the
  -- backfill has not.
  old_sku text,
  old_name text not null,
  captured_at timestamptz not null default now()
);

insert into items_0039_pre_state (id, old_sku, old_name)
  select id, name, type from items
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Backfill `name`. The old sku was nullable, so items that never had one
--    have nothing to be named by — fall back to their type.
-- ---------------------------------------------------------------------------
update items set name = type where name is null or btrim(name) = '';

-- ---------------------------------------------------------------------------
-- 5. Backfill `model` before it is made NOT NULL. Existing rows never carried
--    one; 'Unspecified' is a placeholder an admin can edit.
-- ---------------------------------------------------------------------------
update items set model = 'Unspecified' where model is null or btrim(model) = '';

-- ---------------------------------------------------------------------------
-- 6. That fallback can put two items of the same type on the same name, which
--    the (type, name, model) rule below would reject. Suffix the later ones —
--    oldest keeps the clean name.
-- ---------------------------------------------------------------------------
with duplicates as (
  select id,
         row_number() over (partition by type, name, model order by created_at, id) as n
    from items
)
update items i
   set name = i.name || ' (' || d.n || ')'
  from duplicates d
 where d.id = i.id and d.n > 1;

-- ---------------------------------------------------------------------------
-- 7. Issue a SKU to every existing item. Numbered per type prefix by age, so
--    the oldest Cable is vrlt-cbl-001.
-- ---------------------------------------------------------------------------
with numbered as (
  select id,
         item_sku_prefix(type) as prefix,
         row_number() over (
           partition by item_sku_prefix(type) order by created_at, id
         ) as seq
    from items
)
update items i
   set sku = 'vrlt-' || n.prefix || '-' || lpad(n.seq::text, 3, '0')
  from numbered n
 where n.id = i.id;

-- ---------------------------------------------------------------------------
-- 8. Lock the new shape in.
-- ---------------------------------------------------------------------------
alter table items alter column name set not null;
alter table items alter column model set not null;
alter table items alter column model set default 'Unspecified';
alter table items alter column sku set not null;

alter table items add constraint items_sku_key unique (sku);

-- Two items may share a name only when the type or the model differs — all
-- three are NOT NULL, so unlike a nullable column this actually bites.
create unique index if not exists items_type_name_model_key
  on items (type, name, model);

-- ---------------------------------------------------------------------------
-- 9. The old indexes followed their columns through the rename; rename them to
--    match, and index the new SKU. items_name_idx currently sits on `type`.
-- ---------------------------------------------------------------------------
alter index if exists items_name_idx rename to items_type_idx;
alter index if exists items_sku_idx rename to items_name_idx;
create index if not exists items_sku_idx on items (sku);

-- ---------------------------------------------------------------------------
-- 10. An approved purchase creates a catalog item, so a requested product has
--    to be able to carry the two new fields. Nullable: older rows predate
--    them, and the API falls back to the product name / 'Unspecified'. The
--    existing transaction_products.sku is kept for history but no longer seeds
--    an item's SKU — that is machine-assigned now.
-- ---------------------------------------------------------------------------
alter table transaction_products add column if not exists type text;
alter table transaction_products add column if not exists model text;

-- Replace the transaction builder so it stores the two new product fields.
-- Kept byte-identical to db/schema.sql.
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
      transaction_id, name, description, sku, type, model, specification, quantity, price, item_photo_base64
    ) values (
      v_tx_id,
      (v_prod->>'name')::text,
      (v_prod->>'description')::text,
      (v_prod->>'sku')::text,
      -- 0039: carried so an approved purchase can create a properly shaped
      -- catalog item. Null for older clients; the API falls back on completion.
      (v_prod->>'type')::text,
      (v_prod->>'model')::text,
      (v_prod->>'specification')::text,
      (v_prod->>'quantity')::integer,
      (v_prod->>'price')::numeric,
      (v_prod->>'image_base64')::text
    );
  end loop;

  return v_tx_id;
end;
$$;

commit;

-- 0023: carry SKU + specification through corporate purchases.
-- Purchased products now capture the same item fields as items added directly
-- (name + SKU + specification), so an approved purchase creates a matching
-- catalog item. Idempotent.

alter table transaction_products add column if not exists sku text;
alter table transaction_products add column if not exists specification text;

-- Update the atomic creator to persist sku + specification from the products JSON.
create or replace function create_corporate_transaction(
  p_user_id uuid,
  p_recipient_phone text,
  p_amount numeric,
  p_location_id uuid,
  p_receipt_base64 text,
  p_products jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_tx_id uuid;
  v_prod jsonb;
begin
  insert into corporate_transactions (
    user_id, recipient_phone, amount, status, item_photo_base64, location_id
  ) values (
    p_user_id, p_recipient_phone, p_amount, 'pending', p_receipt_base64, p_location_id
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

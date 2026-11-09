-- =============================================================================
-- 0032_fix_transaction_products_image_column.sql
-- =============================================================================
-- Two BK-related bugs found while syncing schema.sql to 0030/0031:
--
-- 1. 0031_ekash_metadata.sql's create_corporate_transaction() inserted into
--    transaction_products using a column named "image", which has never
--    existed — the real column (added by 0015_add_product_photo_column.sql)
--    is item_photo_base64. Every POST /payments/request would fail at the DB
--    layer with "column image of relation transaction_products does not
--    exist" once 0031 was applied. Fixed below; the function signature is
--    otherwise unchanged from 0031.
--
-- 2. momo_ref (added by 0011_corporate_expense_tables.sql) is typed uuid, but
--    bk.ts's transfer() returns non-UUID strings like
--    "BK_STUB_REF_<timestamp>". Writing that into a uuid column throws, so
--    every BK approval currently fails at "update corporate_transactions set
--    momo_ref = ..." in payments.ts. Widened to text — this also holds real
--    MoMo UUID refs fine, and gives a future real BK reference format room to
--    not be UUID-shaped either.
-- =============================================================================

-- ============================ public (prod) ============================

ALTER TABLE public.corporate_transactions
  ALTER COLUMN momo_ref TYPE text USING momo_ref::text;

CREATE OR REPLACE FUNCTION public.create_corporate_transaction(
  p_user_id UUID,
  p_recipient_phone TEXT,
  p_amount NUMERIC,
  p_location_id UUID,
  p_receipt_base64 TEXT,
  p_products JSONB,
  p_payment_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tx_id UUID;
  v_prod JSONB;
BEGIN
  INSERT INTO public.corporate_transactions (
    user_id,
    recipient_phone,
    amount,
    location_id,
    receipt_base64,
    payment_metadata,
    status
  )
  VALUES (
    p_user_id,
    p_recipient_phone,
    p_amount,
    p_location_id,
    p_receipt_base64,
    p_payment_metadata,
    'pending'
  )
  RETURNING id INTO v_tx_id;

  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_products)
  LOOP
    INSERT INTO public.transaction_products (
      transaction_id,
      name,
      description,
      sku,
      specification,
      quantity,
      price,
      item_photo_base64
    )
    VALUES (
      v_tx_id,
      v_prod->>'name',
      v_prod->>'description',
      v_prod->>'sku',
      v_prod->>'specification',
      (v_prod->>'quantity')::INTEGER,
      (v_prod->>'price')::NUMERIC,
      v_prod->>'image_base64'
    );
  END LOOP;

  RETURN v_tx_id;
END;
$$;

-- ============================ test (mirror) ============================

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'test') THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE test.corporate_transactions ALTER COLUMN momo_ref TYPE text USING momo_ref::text';

  EXECUTE $func$
  CREATE OR REPLACE FUNCTION test.create_corporate_transaction(
    p_user_id UUID,
    p_recipient_phone TEXT,
    p_amount NUMERIC,
    p_location_id UUID,
    p_receipt_base64 TEXT,
    p_products JSONB,
    p_payment_metadata JSONB DEFAULT NULL
  )
  RETURNS UUID
  LANGUAGE plpgsql
  SECURITY INVOKER
  AS $body$
  DECLARE
    v_tx_id UUID;
    v_prod JSONB;
  BEGIN
    INSERT INTO test.corporate_transactions (
      user_id,
      recipient_phone,
      amount,
      location_id,
      receipt_base64,
      payment_metadata,
      status
    )
    VALUES (
      p_user_id,
      p_recipient_phone,
      p_amount,
      p_location_id,
      p_receipt_base64,
      p_payment_metadata,
      'pending'
    )
    RETURNING id INTO v_tx_id;

    FOR v_prod IN SELECT * FROM jsonb_array_elements(p_products)
    LOOP
      INSERT INTO test.transaction_products (
        transaction_id,
        name,
        description,
        sku,
        specification,
        quantity,
        price,
        item_photo_base64
      )
      VALUES (
        v_tx_id,
        v_prod->>'name',
        v_prod->>'description',
        v_prod->>'sku',
        v_prod->>'specification',
        (v_prod->>'quantity')::INTEGER,
        (v_prod->>'price')::NUMERIC,
        v_prod->>'image_base64'
      );
    END LOOP;

    RETURN v_tx_id;
  END;
  $body$;
  $func$;

END;
$do$;

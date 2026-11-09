-- =============================================================================
-- 0031_ekash_metadata.sql
-- =============================================================================
-- Adds support for Bank of Kigali (EKASH) payment metadata to corporate_transactions.
-- =============================================================================

-- ============================ public (prod) ============================

-- Make recipient_phone nullable since BK transfers don't require it
ALTER TABLE public.corporate_transactions 
  ALTER COLUMN recipient_phone DROP NOT NULL;

-- Add payment_metadata to store Bank Account Number, Holder Name, and TIN
ALTER TABLE public.corporate_transactions 
  ADD COLUMN IF NOT EXISTS payment_metadata JSONB;

-- Drop and recreate the function to accept payment_metadata
DROP FUNCTION IF EXISTS public.create_corporate_transaction(UUID, TEXT, NUMERIC, UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.create_corporate_transaction(UUID, TEXT, NUMERIC, UUID, TEXT, JSONB, JSONB);

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
  -- Insert the parent transaction record
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

  -- Insert each product from the JSON array
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
      image
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

  EXECUTE 'ALTER TABLE test.corporate_transactions ALTER COLUMN recipient_phone DROP NOT NULL';
  EXECUTE 'ALTER TABLE test.corporate_transactions ADD COLUMN IF NOT EXISTS payment_metadata JSONB';

  EXECUTE $func$
  DROP FUNCTION IF EXISTS test.create_corporate_transaction(UUID, TEXT, NUMERIC, UUID, TEXT, JSONB);
  DROP FUNCTION IF EXISTS test.create_corporate_transaction(UUID, TEXT, NUMERIC, UUID, TEXT, JSONB, JSONB);
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
        image
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

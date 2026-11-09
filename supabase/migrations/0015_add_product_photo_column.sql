-- =============================================================================
-- 0015_add_product_photo_column.sql
-- =============================================================================
-- Add item_photo_base64 column to transaction_products and update the RPC.
-- =============================================================================

ALTER TABLE public.transaction_products 
ADD COLUMN IF NOT EXISTS item_photo_base64 TEXT;

ALTER TABLE test.transaction_products 
ADD COLUMN IF NOT EXISTS item_photo_base64 TEXT;

-- Drop old function signature to avoid collisions
DROP FUNCTION IF EXISTS public.create_corporate_transaction(UUID, TEXT, NUMERIC, UUID, TEXT, JSONB);

-- Create updated function that inserts into item_photo_base64 for transactions
-- and also records individual product photos into transaction_products.
CREATE OR REPLACE FUNCTION public.create_corporate_transaction(
  p_user_id UUID,
  p_recipient_phone TEXT,
  p_amount NUMERIC,
  p_location_id UUID,
  p_receipt_base64 TEXT,
  p_products JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tx_id UUID;
  v_prod JSONB;
BEGIN
  -- Insert the parent transaction record with upfront item photo of the first item
  INSERT INTO public.corporate_transactions (
    user_id,
    recipient_phone,
    amount,
    status,
    item_photo_base64, -- Store upfront photo in item_photo_base64
    location_id
  ) VALUES (
    p_user_id,
    p_recipient_phone,
    p_amount,
    'pending',
    p_receipt_base64,
    p_location_id
  )
  RETURNING id INTO v_tx_id;

  -- Loop and insert all child products with their individual photos
  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_products) LOOP
    INSERT INTO public.transaction_products (
      transaction_id,
      name,
      description,
      quantity,
      price,
      item_photo_base64
    ) VALUES (
      v_tx_id,
      (v_prod->>'name')::TEXT,
      (v_prod->>'description')::TEXT,
      (v_prod->>'quantity')::INTEGER,
      (v_prod->>'price')::NUMERIC,
      (v_prod->>'image_base64')::TEXT
    );
  END LOOP;

  -- Return the transaction ID
  RETURN v_tx_id;
END;
$$;

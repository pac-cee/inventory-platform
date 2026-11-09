-- =============================================================================
-- 0013_cart_and_payments_additions.sql
-- =============================================================================
-- Adjusts tables, updates RLS, and adds function for handling multi-item payments atomically.
-- =============================================================================

-- 1. Add failure_reason column to corporate_transactions (for tracking MoMo failures)
ALTER TABLE public.corporate_transactions 
ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE test.corporate_transactions 
ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- 2. Update RLS policies to allow employees to upload receipts (update their own transactions)
DROP POLICY IF EXISTS "transactions_update" ON public.corporate_transactions;
CREATE POLICY "transactions_update" ON public.corporate_transactions
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin_or_cashier());

DROP POLICY IF EXISTS "transactions_update" ON test.corporate_transactions;
CREATE POLICY "transactions_update" ON test.corporate_transactions
  FOR UPDATE USING (auth.uid() = user_id OR test.is_admin_or_cashier());

-- 3. Create helper RPC function for atomic multi-item transaction inserts
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
SECURITY INVOKER -- Respects RLS policies of the invoker
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
    status,
    receipt_base64,
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

  -- Loop and insert all child products
  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_products) LOOP
    INSERT INTO public.transaction_products (
      transaction_id,
      name,
      description,
      quantity,
      price
    ) VALUES (
      v_tx_id,
      (v_prod->>'name')::TEXT,
      (v_prod->>'description')::TEXT,
      (v_prod->>'quantity')::INTEGER,
      (v_prod->>'price')::NUMERIC
    );
  END LOOP;

  -- Return the transaction ID
  RETURN v_tx_id;
END;
$$;

-- Allow admins and cashiers to insert stock movements on behalf of other users
-- This fixes the RLS error when an admin resolves a corporate transaction 
-- and the backend attempts to check-in the newly purchased stock.

DROP POLICY IF EXISTS "movements_insert" ON public.stock_movements;
CREATE POLICY "movements_insert" ON public.stock_movements
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR 
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'admin' OR fallback_role = 'cashier'))
  );

-- Also update the test schema just in case tests are run
DROP POLICY IF EXISTS "movements_insert" ON test.stock_movements;
CREATE POLICY "movements_insert" ON test.stock_movements
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR 
    EXISTS (SELECT 1 FROM test.profiles WHERE id = auth.uid() AND (role = 'admin' OR fallback_role = 'cashier'))
  );

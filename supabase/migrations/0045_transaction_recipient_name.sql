-- =============================================================================
-- 0045_transaction_recipient_name.sql
-- =============================================================================
-- The name of the person a Bank of Kigali / UrubutoPay mobile-money payment goes
-- to. UrubutoPay's beneficiary needs a name, and until now every phone payment
-- was sent with the placeholder "Employee Reimbursement".
--
-- Nullable on purpose: payments made before this, and by older app builds, have
-- none, and the transfer falls back to the placeholder for them.
--
-- Additive and re-runnable. It does NOT touch create_corporate_transaction: the
-- API sets the name in the same request, right after that function returns.
-- =============================================================================

alter table public.corporate_transactions
  add column if not exists recipient_name text;

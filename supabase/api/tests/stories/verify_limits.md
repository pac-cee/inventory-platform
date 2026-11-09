# Verify Limits

**Middleware**: `verifyLimits` (used by payment routes before any transaction)
**Auth**: caller must already be authenticated (runs after requireAuth)

## Scenarios

- [x] missing/zero/negative amount → 400 invalid_amount
- [x] profile cannot be loaded → 403 profile_load_failed
- [x] member with no payment permission and no cashier fallback → 403 no_payment_permission
- [x] member WITH has_payment_permission → passes through (next called)
- [x] member with fallback_role cashier → passes through regardless of has_payment_permission
- [x] amount exceeds per_transaction_limit → 422 limit_per_transaction_exceeded
- [x] daily spent + amount exceeds daily_limit (monthly_limit = 0) → 422 limit_daily_exceeded
- [x] monthly spent + amount exceeds monthly_limit (daily_limit = 0) → 422 limit_monthly_exceeded
- [x] both daily and monthly limits set, daily passes but monthly fails → 422 limit_monthly_exceeded
- [x] all limits within bounds → next called
- [x] all limits zero (no caps configured) → next called regardless of amount

## Notes

daily_limit and monthly_limit checks are skipped when their value is 0, so
tests that isolate one must set the other to 0. The "both set" scenario
(daily passes, monthly fails) is a distinct code path worth its own test.

# Signup

**Endpoint**: `POST /auth/signup`
**Auth**: none

## Scenarios

- [x] valid new email + password → 201 with user and session
- [ ] duplicate email → behavior depends on Supabase config; not yet tested
- [x] missing email → 422 validation_error
- [x] missing password → 422 validation_error
- [x] password shorter than 6 chars → 422 validation_error

## Notes

When email confirmation is disabled in local Supabase config, signup returns a
session immediately. With confirmation enabled, `session` is null and the user
must confirm before logging in. Test behaviour matches the local config.

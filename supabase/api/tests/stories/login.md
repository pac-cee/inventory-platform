# Login

**Endpoint**: `POST /auth/login`
**Auth**: none

## Scenarios

- [x] valid credentials → 200 with session and user
- [x] wrong password → 401 `invalid_credentials`
- [x] missing email field → 422 validation_error
- [x] missing password field → 422 validation_error
- [x] password shorter than 6 chars → 422 validation_error
- [ ] non-existent email → 401 (Supabase returns same error as wrong password)

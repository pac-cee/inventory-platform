# Create User

**Endpoint**: `POST /users`
**Auth**: admin only

## Scenarios

- [x] admin creates member → 201 with user object
- [x] admin creates admin → 201 with user object
- [x] member attempts → 403 not_admin
- [x] unauthenticated → 401 no_token
- [x] invalid email format → 422 validation_error
- [x] password shorter than 6 chars → 422 validation_error
- [ ] duplicate email → 400 create_user_failed (GoTrue rejects it)

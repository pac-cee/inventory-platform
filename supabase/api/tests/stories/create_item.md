# Create Item

**Endpoint**: `POST /items`
**Auth**: admin only (enforced by RLS — no explicit requireAdmin middleware)

## Scenarios

- [x] admin creates item → 201 with item object
- [x] member attempts → 403 (RLS 42501 → 403)
- [x] unauthenticated → 401 no_token
- [x] missing name → 422 validation_error
- [x] missing type → 422 validation_error (the SKU could not be built)
- [x] missing model → 422 validation_error
- [x] duplicate (type, name, model) → 409 duplicate_item
- [x] SKU is assigned by the server; a client-supplied one is ignored
- [x] items of one type are numbered 001, 002, 003 in turn

# List Items

**Endpoint**: `GET /items`
**Auth**: any authenticated user

## Scenarios

- [x] authenticated member → 200 array
- [x] authenticated admin → 200 array
- [x] unauthenticated → 401 no_token
- [x] search param filters by type/name/model/SKU/specification (case-insensitive)
- [ ] limit/offset pagination controls result window

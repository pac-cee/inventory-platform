# Get Location

**Endpoint**: `GET /locations/:id`
**Auth**: any authenticated user

## Scenarios

- [x] existing id → 200 with location object
- [x] non-existent id → 404
- [x] unauthenticated → 401 no_token

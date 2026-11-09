# Get Item

**Endpoint**: `GET /items/:id`
**Auth**: any authenticated user

## Scenarios

- [x] existing id → 200 with item object
- [x] non-existent id → 404
- [x] unauthenticated → 401 no_token

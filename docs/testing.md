# Postman / gray-box API test guide — Inventory API

> Gray-box testing reference for the re-platformed Express + pg Inventory API.
> Live target (org Railway): **https://api-production-4a46.up.railway.app**
> Web (for UI flows): https://web-production-c3962.up.railway.app
> All paths below are relative to the API base URL.

## 0. Base + auth model

- Base URL: `{{api}}` (set a Postman env var `api` = `https://api-production-4a46.up.railway.app`).
- Auth: `Authorization: Bearer <access_token>`. Get tokens from `POST /auth/login`.
- Tokens: `login` returns `{ user, session: { access_token, refresh_token } }`.
  Use `session.access_token` as the Bearer token.
- Public routes (no token): `/auth/signup`, `/auth/login`, `/auth/forgot-password`,
  `/auth/reset-password`, `/auth/verify-email`, `/health`.
- Authenticated routes: everything under `/auth/me`, `/profiles`, `/users`, `/locations`,
  `/items`, `/stock`, `/movements`, `/payments`, `/admin` (token in `Authorization` header).

## 1. Health (public, no auth)

`GET {{api}}/health`
- 200 → `{ "status": "ok", "service": "inventory-api" }`

## 2. Auth flows

### 2.1 Signup (public)
`POST {{api}}/auth/signup`
```json
{ "email": "new.user@example.com", "password": "Str0ngPass!1", "full_name": "New User" }
```
- 201 → `{ "user": { ... } }` — **NO `session`** (email must be verified first; see Phase B #1).
- The account starts `email_confirmed = false`. Verify via the emailed link (token in
  `/auth/verify-email`), then login.

### 2.2 Login (public, rate-limited + per-email lockout)
`POST {{api}}/auth/login`
```json
{ "email": "tonyquano98@gmail.com", "password": "<your-password>" }
```
- 200 → `{ "user": {...}, "session": { "access_token": "...", "refresh_token": "..." } }`
- 401 → invalid credentials (records a failed attempt; 5 failures → 429 lockout 15 min).
- 403 `email_not_verified` → account exists but email not confirmed (fix: verify email).
- 429 → too many attempts (IP limiter or per-email lockout).

### 2.3 Verify email (public)
`POST {{api}}/auth/verify-email`
```json
{ "token": "<token-from-verify-email-link>" }
```
- 200 → `{ "message": "Email verified. You can now sign in." }`

### 2.4 Forgot / reset password (public)
`POST {{api}}/auth/forgot-password` → `{ "email": "someone@example.com" }`
- Always 200 (no user enumeration). Reset link emailed.

`POST {{api}}/auth/reset-password`
```json
{ "token": "<reset-token-from-email>", "new_password": "An0therStr0ng!" }
```
- 200 → password reset. Prior unused reset tokens are invalidated.

### 2.5 Refresh / logout / change-password (auth required)
- `POST {{api}}/auth/refresh` → `{ "refresh_token": "<refresh_token>" }` → new session.
- `POST {{api}}/auth/logout` (Bearer) → 204.
- `POST {{api}}/auth/change-password` (Bearer) →
  `{ "current_password": "...", "new_password": "..." }` → 204.

### 2.6 Current user
`GET {{api}}/auth/me` (Bearer) → `{ "user": {...}, "profile": {...} }`

## 3. Payments (Bearer + payment access required)

All `/payments/*` require `Authorization: Bearer <access_token>` AND a profile with
payment access (`has_payment_permission` or `fallback_role = cashier`). Admin has both.

### 3.1 Request a payment (MoMo demo)
`POST {{api}}/payments/request`
```json
{
  "recipient_phone": "250780000000",
  "amount": 5000,
  "location_id": "<a-valid-location-uuid>",
  "products": [
    { "name": "NEMA 17 Stepper Motor", "quantity": 2, "price": 2500,
      "description": "1.8deg bipolar" }
  ],
  "receipt_base64": null
}
```
- Server recomputes `amount` from `products` (sum of price*qty) — the `amount` field is
  overridden by the server, so the products array is what matters.
- **Demo mode (`MOMO_MODE=demo` on the server):** the MoMo transfer is MOCKED and
  deterministically **SUCCEEDS** → the transaction resolves to `completed`. This is the
  intended boss-demo path (no real MTN sandbox flakiness).
- Normal (non-demo) mode would call MTN MoMo and may fail in sandbox.

### 3.2 Resolve a payment (admin/cashier)
`POST {{api}}/payments/resolve`
```json
{ "id": "<transactionId-from-request-response>", "status": "approved" }
```
- `status` is `approved` | `rejected` (note: the request body uses `id`, NOT
  `transaction_id`, and `status`, NOT `action`).
- Response: `{ "transactionId": "...", "status": "completed" }` (on `approved`).
  In **demo mode** (`MOMO_MODE=demo` on the server) the MoMo transfer is mocked and
  the transaction resolves to `completed` deterministically — the intended boss-demo
  path. (Rejecting sets it to `failed`.)

> Note: `/payments/request` returns `{ "transactionId": "...", "status": "pending" }`
> (camelCase `transactionId`, not `id`).

### 3.3 Other payment reads
- `GET {{api}}/payments/balance` (admin)
- `GET {{api}}/payments/transactions`
- `GET {{api}}/payments/budgets` (admin/cashier)
- `GET {{api}}/payments/reports/export`

## 4. Generic CRUD (Bearer; admin for writes)
- `GET/POST {{api}}/locations`, `GET/POST {{api}}/items`,
  `GET/POST {{api}}/stock`, `GET/POST {{api}}/movements`,
  `GET {{api}}/profiles`, `GET {{api}}/users`.
- Admin-only mutations vary by resource; 403 if insufficient role.

## 5. Boss-demo script (gray-box, happy path)
1. `GET {{api}}/health` → ok.
2. `POST {{api}}/auth/login` as `tonyquano98@gmail.com` → capture `access_token`.
3. `GET {{api}}/auth/me` (Bearer) → shows admin profile.
4. `POST {{api}}/payments/request` with a product → 200, returns transaction id.
5. `POST {{api}}/payments/resolve` with `{ "id": "<transactionId>", "status": "approved" }`
   → `completed`. (In demo mode this is the deterministic success; the MoMo step
   is mocked.)
6. Optionally show `GET {{api}}/payments/transactions` reflecting the completed tx.

## 6. Known limitations / deferred findings
- #5 credential oracle (403 only after correct password) — deferred, LOW.
- #7 email normalization in lockout key — partially handled by `citext`; deferred, LOW.
- `MOMO_MODE=demo` is set on the org api for the demo; remove for real MoMo later.

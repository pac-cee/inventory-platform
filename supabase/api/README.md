# Inventory API

A small **Express + TypeScript** service that both the `web/` and `mobile/` apps
talk to. It is the single shared backend-for-frontend: clients never touch the
database directly.

## Why it exists

- One place for auth + data logic shared by web and mobile (no duplicated queries).
- It owns authentication (self-issued JWT sessions) and enforces authorization in
  the application layer, then runs all queries as **raw SQL over a `pg` pool**
  (`src/db.ts`) against **Neon PostgreSQL**.

```
web / mobile  ──►  inventory-api (Express)  ──►  Neon PostgreSQL
```

> Re-platformed off Supabase (GoTrue + supabase-js + RLS) onto self-hosted auth +
> Neon. The client contract is frozen (`{ user, session }`, the
> `{ error: { message, code } }` envelope, 401-triggers-refresh, CSV export), so
> web and mobile were untouched. See [`../../docs/architecture.md`](../../docs/architecture.md).

## Setup

```bash
cd supabase/api
cp .env.example .env     # fill in DATABASE_URL + JWT_SECRET
npm install
npm run dev              # http://localhost:4000 (tsx watch)
```

Apply the schema once (see [`../README.md`](../README.md)):
`psql "$DATABASE_URL" -f db/schema.sql`, then optionally `node db/seed.mjs`.

| Variable            | Description                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL connection string (Neon pooled URL, `?sslmode=require`)     |
| `JWT_SECRET`        | Secret for signing/verifying the API's HS256 access tokens (required) |
| `ACCESS_TOKEN_TTL`  | Access-token lifetime in seconds (default `3600`)                      |
| `REFRESH_TOKEN_TTL` | Refresh-token lifetime in seconds (default `2592000` = 30d)            |
| `PORT`              | Listen port (default `4000`)                                          |
| `CORS_ORIGINS`      | Comma-separated allowed origins, or `*` (dev only)                    |
| `MOMO_*`            | MTN MoMo credentials; leave blank to run payments in **mock mode**     |

```bash
npm run build && npm start   # compile to dist/ and run with node
npm run typecheck            # tsc --noEmit
npm test                     # vitest (APP_ENV=test)
```

`APP_ENV=<name>` layers `.env.<name>` over `.env` (overriding `DATABASE_URL` /
`PORT` / `CORS_ORIGINS`), which is how test/prod are selected — see
[`../../docs/ENVIRONMENTS.md`](../../docs/ENVIRONMENTS.md).

## Auth model

Auth is self-hosted (`src/auth-service.ts`): passwords are hashed with **bcrypt**,
sessions are **HS256 JWTs** signed with `JWT_SECRET` (`jose`). Clients send the
access token as `Authorization: Bearer <jwt>`. The `requireAuth` middleware
verifies it, loads the caller's profile, and **rejects blocked users on every
request**. Refresh tokens are stored hashed and **rotated** on every
`POST /auth/refresh` (with a double-use guard); logout revokes the session.

Authorization is enforced here (not in the DB) via role middleware:
`requireAdmin`, `requireAdminOrCashier`, `requirePaymentAccess`.

## Endpoints

All routes except `/health` and the `/auth/*` entry points require a Bearer token.

### Health
- `GET /health`

### Auth
- `POST /auth/signup` — `{ email, password, full_name? }` → `{ user, session }`
- `POST /auth/login` — `{ email, password }` → `{ user, session }`
- `POST /auth/refresh` — `{ refresh_token }` → `{ user, session }` (rotates the token)
- `POST /auth/logout` — revokes the current session *(auth required)*
- `GET  /auth/me` — `{ user, profile }` *(auth required)*

### Profiles
- `GET   /profiles` — all profiles (to resolve display names in the log)
- `GET   /profiles/me`
- `PATCH /profiles/me` — `{ full_name }`

### Locations  *(writes are admin-only, enforced by `requireAdmin`)*
- `GET /locations` · `GET /locations/:id`
- `POST /locations` — `{ name }`
- `PATCH /locations/:id` — `{ name? }`
- `DELETE /locations/:id`

### Items  *(writes are admin-only, enforced by `requireAdmin`)*
- `GET /items?search=&limit=&offset=` · `GET /items/:id`
- `GET /items/:id/stock` — per-location stock for one item
- `POST /items` — `{ name, sku?, specification?, category?, finishable?, units_per_container?, package_label? }`
- `PATCH /items/:id` · `DELETE /items/:id`

### Stock
- `GET /stock?item_id=&location_id=` — current levels, item + location joined in

### Movements (check-out / check-in log)
- `GET /movements?item_id=&location_id=&user_id=&mine=&limit=&offset=` — activity log
- `POST /movements` — `{ item_id, location_id, delta, note? }` (negative = out, positive = in)
- `POST /movements/check-out` — `{ item_id, location_id, quantity, note? }`
- `POST /movements/check-in` — `{ item_id, location_id, quantity, note? }`
- `POST /movements/destroy` · `POST /movements/lost` —
  `{ item_id, location_id, quantity, note, recommendation?, damaged_by? }`.
  **`note` is required**: it says what is wrong, and the condition report's
  Condition column is a tally of exactly those words.
- `POST /movements/repair` — `{ item_id, location_id, quantity, resolves? }`.
  `resolves` names the fault being cleared, so the condition report drops the
  right clause instead of an arbitrary one.
- `GET /movements/faults?item_id=&location_id=` — outstanding faults for an
  (item, location): what is wrong, how many units, and what was recommended

### Reports  *(admin-only)*
- `GET /movements/report?…` — the activity report over the ledger
- `GET /reports/condition?location_id=&category=&item_id=&faulty_only=` —
  current state per (item, location), grouped by room and category. Quantity,
  damaged, operational and the fault tally; `location_id` includes everything
  nested under it. Nothing is stored — it is all derived.
- `GET /reports/categories` — the distinct `items.category` values in use

### Corporate Payments & Budgets  *(gated by `requirePaymentAccess`)*
- `PATCH /profiles/:id/payment-settings` — Set per-user daily/monthly/tx spending limits
- `GET /payments/budget` — View the active monthly budget
- `PATCH /payments/budget` — Update the monthly corporate budget allocation
- `POST /payments/request` — Submit a new cart of corporate expense requests
- `POST /payments/resolve` — Approve/Reject a transaction; auto-disburses via MoMo if approved
- `GET /payments/balance` — Check the live sandbox MoMo balance
- `PATCH /payments/transactions/:id/receipt` — Attach receipt image to a transaction
- `GET /payments/transactions` — Query the transaction log (Admins see all, Members see own)
- `GET /payments/reports/export` — Download a CSV of the expense ledger

The `apply_stock_movement` Postgres trigger keeps `item_stock` in sync on every
movement insert.

## Error shape

```json
{ "error": { "message": "human readable", "code": "machine_code" } }
```

Authorization denials map to `403`, unique violations to `409`, check violations
(e.g. stock would go negative) to `422`, and validation failures to `422` with a
`details` field.

# Architecture

```
┌────────────────┐        ┌─────────────────┐
│  Web (Next.js) │        │ Mobile (Flutter)│
│  (Railway)     │        │  Android + iOS  │
│                │        │                 │
└────────┬───────┘        └────────┬────────┘
         │  fetch (server-side)     │  http
         │  Bearer <jwt>            │  Bearer <jwt>
         └─────────┬────────────────┘
                   ▼
         ┌──────────────────────┐
         │  inventory-api        │   Express + TypeScript (Railway)
         │  (supabase/api)       │   verifies its own JWT, runs raw SQL,
         │                       │   enforces authz, MoMo integration
         └──────────┬───────────┘
                    │  pg connection pool (raw SQL)
                    ▼
         ┌──────────────────────┐
         │   Neon PostgreSQL     │
         │  ┌────────────────┐  │
         │  │ users +        │  │  bcrypt password hashes,
         │  │ refresh_tokens │  │  rotating refresh sessions
         │  ├────────────────┤  │
         │  │  app tables    │  │  profiles, locations, items,
         │  │                │  │  item_stock, stock_movements,
         │  │                │  │  budgets, corporate_txs
         │  └────────────────┘  │
         └──────────────────────┘
```

Both clients talk **only** to `inventory-api` — they never touch the database
directly. The API is the shared backend-for-frontend: it authenticates users,
issues its own JWT sessions, and runs every data query as raw SQL over a `pg`
connection pool (`supabase/api/src/db.ts`). Authorization is enforced in the
application layer (Express middleware), not by the database.

> **History:** the backend was re-platformed off Supabase (GoTrue Auth +
> supabase-js + Row Level Security) onto self-hosted auth + Neon PostgreSQL. The
> client contract was kept frozen — the `{ user, session }` shape, the
> `{ error: { message, code } }` envelope, 401-triggers-refresh, and CSV export
> are all unchanged — so web and mobile needed no changes. The `supabase/`
> directory keeps its name for historical reasons only. See
> [`../supabase/api/README.md`](../supabase/api/README.md).

## Auth flow

Auth is self-hosted in `supabase/api/src/auth-service.ts` (bcrypt + `jose`).

1. User submits the login form (web) or login screen (mobile).
2. The client calls `POST /auth/login`. The API looks the user up in the `users`
   table, verifies the password with **bcrypt**, and returns a session: a
   short-lived **HS256 access token** (signed with `JWT_SECRET`, carries `sub`,
   `email`, and a session id `sid`) plus an opaque **refresh token**.
3. Refresh tokens are stored **hashed** (SHA-256) in the `refresh_tokens` table,
   one row per session. `POST /auth/refresh` rotates them: the presented token is
   revoked and a new one issued, with a double-use guard so a stolen/replayed
   token can't mint a second live session.
4. **Web** stores the tokens in httpOnly cookies (`web/src/lib/session.ts`). The
   session middleware (`web/src/lib/session-middleware.ts`) validates the access
   token on every request, refreshes it via `POST /auth/refresh` shortly before
   expiry, and gates protected vs. auth routes. All API calls happen server-side
   (`web/src/lib/api/server.ts`) so tokens stay httpOnly.
5. **Mobile** stores the tokens in secure storage (`mobile/lib/config/api_client.dart`)
   and attaches the Bearer token to every request, auto-refreshing once on a 401.
   `ApiClient.isAuthenticated` drives the `_AuthGate` in `main.dart`.
6. `requireAuth` (`supabase/api/src/middleware/auth.ts`) verifies the access token
   on every protected request, loads the caller's `profiles` row, and **rejects a
   blocked user immediately** (403 on every request).
7. Sign out calls `POST /auth/logout`, which revokes that session's refresh
   tokens, then clears local tokens.
8. `POST /auth/signup` creates the `users` row (with a bcrypt hash) and its
   `profiles` row in a single transaction.

> **Note:** email/password only — there is no OAuth or email-confirmation PKCE
> flow. The web `/auth/callback` route just redirects to login.

## Data model

Neon PostgreSQL. Full DDL: [`../supabase/api/db/schema.sql`](../supabase/api/db/schema.sql).

- **users** — auth identity: email, bcrypt `password_hash`, `email_confirmed`.
- **refresh_tokens** — one row per issued refresh token (hashed), with
  `session_id`, `revoked`, `expires_at`; supports rotation + per-session revoke.
- **profiles** — `id` (FK → `users`), display name, role (`member` / `admin`),
  `fallback_role` (e.g. `cashier`), `blocked`, and payment/budget limits.
- **locations** — physical places stock lives.
- **items** — catalog (type, name, model, machine-assigned sku, specification).
- **item_stock** — current quantity per `(item, location)`; updated by trigger.
- **stock_movements** — append-only log: `(item, location, user, delta, note,
  reversal_of, created_at)`. The `apply_stock_movement` trigger keeps
  `item_stock` in sync on every insert.
- **monthly_budgets** — the global limit for corporate expenses per month.
- **corporate_transactions** — employee purchase requests, disbursed via either
  MTN MoMo (Disbursements API — funds are pushed directly to the recipient's
  wallet; there is no USSD step in this flow) or Bank of Kigali (`bk`, currently
  a stub pending real API access) (created atomically by the
  `create_corporate_transaction` function).
- **transaction_products** — cart contents for a corporate transaction.

## Authorization

Row Level Security is gone. The former RLS policies are reimplemented as explicit
Express checks in `supabase/api/src/middleware/auth.ts`, applied per route:

- **`requireAuth`** — valid access token required; loads the profile and blocks
  any user with `blocked = true` (checked on every request).
- **`requireAdmin`** — `role = 'admin'`. Guards create/edit/delete of items and
  locations, user management, budgets, etc.
- **`requireAdminOrCashier`** — admins or users whose `fallback_role = 'cashier'`.
- **`requirePaymentAccess`** — admins/cashiers, or a member with
  `has_payment_permission`. Guards the corporate-payment endpoints.

Reads of items, locations, stock, movements, and profiles are available to any
authenticated user. Denials surface as `403`.

To promote a user to admin, run against the database:
```sql
update profiles set role = 'admin' where id = '<user-uuid>';
```

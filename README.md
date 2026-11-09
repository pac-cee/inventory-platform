# Internal Inventory App

Verlet Robotics' internal system for tracking stock (who took what, when, and
current counts across locations) and for running employee corporate-expense
requests that disburse via the MTN MoMo API. It ships as a web dashboard and a
native mobile app on a shared Express backend and a Neon PostgreSQL database.

## Stack

| Layer             | Tech                                                            |
| ----------------- | -------------------------------------------------------------- |
| Website           | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4  |
| Mobile (iOS/And.) | Flutter (Dart)                                                 |
| Backend API       | Express + TypeScript (Node 22) — the shared BFF                |
| Database          | Neon PostgreSQL (`pg`)                                         |
| Auth              | Self-issued HS256 JWTs (`jose`) + bcrypt; rotating refresh tokens |
| Payments          | MTN MoMo API (disbursement; mock mode when unconfigured)       |

> **Note:** the backend was re-platformed off Supabase onto **Neon PostgreSQL**.
> The API now issues its own JWT sessions and enforces authorization in the
> application layer — there is no Supabase Auth or Row Level Security anymore. The
> `supabase/` directory keeps its name for historical reasons; it is just where
> the API and the SQL schema live.

## Architecture

Both clients talk **only** to the Express API (`supabase/api`) — never to the
database directly. The API is the shared backend-for-frontend:

- **Auth** — verifies email/password with bcrypt, issues its own HS256 access
  tokens (`jose`) plus rotating refresh tokens with per-session revocation
  (`users` + `refresh_tokens` tables). Clients send `Authorization: Bearer <jwt>`.
- **Data** — all queries are raw SQL over a `pg` connection pool (`src/db.ts`).
- **Authz** — enforced explicitly in Express: an admin / cashier / member role
  matrix, a blocked-user check on every request, and payment-permission checks.
- MoMo secrets live only in the API.

```
┌────────────────┐        ┌─────────────────┐
│  Web (Next.js) │        │ Mobile (Flutter)│
│  (Railway)     │        │  Android + iOS  │
└────────┬───────┘        └────────┬────────┘
         │  Bearer <jwt>            │  Bearer <jwt>
         └─────────┬────────────────┘
                   ▼
         ┌──────────────────────┐
         │  inventory-api        │  Express + TS (Railway)
         │  (supabase/api)       │  bcrypt · JWT · MoMo integration
         └──────────┬───────────┘
                    │  pg pool (raw SQL)
                    ▼
         ┌──────────────────────┐
         │  Neon PostgreSQL      │  users · profiles · locations · items ·
         │                       │  stock · movements · budgets · txns
         └──────────────────────┘
```

## Repository layout

```
internal-inventory-app/
├── web/                 Next.js dashboard (TypeScript, Tailwind, shadcn/ui style)
├── mobile/              Flutter app (Android + iOS)
├── supabase/            (legacy name — no longer uses Supabase)
│   ├── api/             Shared Express API + Neon schema (db/schema.sql, db/seed.mjs)
│   ├── migrations/      Legacy Supabase SQL history (superseded by api/db/schema.sql)
│   ├── perf/            k6 load tests + endpoint analyzer
│   └── snippets/        One-off SQL helpers
└── docs/                Architecture + deployment notes (being updated for Neon)
```

Each subdirectory has its own README with detailed setup:
[`web`](web/README.md) · [`mobile`](mobile/README.md) ·
[`api`](supabase/api/README.md) · [`perf`](supabase/perf/README.md)

## Quick start

Start the stack bottom-up: database → API → web/mobile.

```bash
# 1. Database — provision a Neon (or any) PostgreSQL database, then apply the
#    schema in supabase/api/db/schema.sql and optionally run the seed script.

# 2. Shared API  (http://localhost:4000)
cd supabase/api && cp .env.example .env   # set DATABASE_URL + JWT_SECRET
npm install
node db/seed.mjs                          # optional: seed demo data
npm run dev

# 3. Website     (http://localhost:3000)
cd web && cp .env.example .env.local      # API_URL=http://localhost:4000
npm install && npm run dev

# 4. Mobile (after installing the Flutter SDK)
cd mobile && cp .env.example .env         # API_URL=http://10.0.2.2:4000 (Android emu)
flutter pub get && flutter run
```

The repo root exposes convenience scripts for the API:

```bash
npm run api:install   # npm --prefix supabase/api install
npm run api:dev       # tsx watch (http://localhost:4000)
npm run api:build     # tsc -> dist/
npm run api:start     # node dist/index.js
npm run api:typecheck # tsc --noEmit
```

## Environment variables

| App    | File         | Key vars                                                                 |
| ------ | ------------ | ------------------------------------------------------------------------ |
| API    | `.env`       | `DATABASE_URL`, `JWT_SECRET` (required); `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `PORT`, `CORS_ORIGINS`, `MOMO_*` (optional) |
| Web    | `.env.local` | `API_URL`                                                                |
| Mobile | `.env`       | `API_URL`                                                                |

See each `.env.example`:
[api](supabase/api/.env.example) · [web](web/.env.example) · [mobile](mobile/.env.example).
Leave the `MOMO_*` values blank to run the payment gateway in **mock mode**.

## Testing

The API has a Vitest + Supertest suite:

```bash
cd supabase/api
npm test          # APP_ENV=test vitest run
npm run test:watch
```

Load testing (k6) lives in [`supabase/perf`](supabase/perf/README.md).

## Features

**Inventory**
- Email + password authentication (bcrypt, JWT sessions, auto-refresh)
- Item catalog with per-location stock counts
- Check-out / check-in flow (who took what, when, how many)
- Append-only activity log per item and per user
- QR codes per item + in-app scanning (web + mobile)
- Locations, low-stock surfacing, search
- Finishable / consumable items; stock capped at initial quantity

**Admin**
- Role management (`admin` / `cashier` / `member`), user create/delete, user blocking
- Add/edit/delete items and locations

**Corporate expenses (MTN MoMo)**
- Employee "request cart" with receipt/photo capture and a MoMo recipient number
- Monthly global budget + per-user daily / monthly / per-transaction limits
- Admin approve/reject; approval auto-disburses via the MoMo API and updates stock
- Live sandbox balance check
- CSV export of the expense ledger + personal spend views

**Reporting**
- Activity report — movements by item, location, person and date range
- **Condition report** — room → category → item, with quantity, a plain-English
  condition, % operational and a recommendation. Marking stock damaged or lost
  requires recording *why*; a repair names the fault it clears. Both derived
  from the ledger rather than entered by hand.

### In progress (feature branches)

Not yet merged to `main`:

- `feat/item-category` — managed item categories
- `feat/item-specification` — item specification field
- `feat/item-edit` — admin edit of item details
- `feat/item-multi-location` — stocking one item across multiple locations
- `feat-mobile-password-reset` — mobile password reset

`feat-robertAppHardenning` merged in #18 (location deletion, stock accuracy,
admin stock controls, and the condition report).

## Deployment

- **Web** → Railway (`web/railway.json`). `web/vercel.json` is left over and unused.
- **API** → Railway (`supabase/api/railway.json`)
- **Database** → Neon (or any managed PostgreSQL)

See [`docs/railway-deploy.md`](docs/railway-deploy.md) and
[`docs/MOBILE_DEPLOY.md`](docs/MOBILE_DEPLOY.md).

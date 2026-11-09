# Environments: dev / staging / prod

> **Updated for Neon.** The backend was re-platformed off Supabase onto Neon
> PostgreSQL with self-hosted auth, so environments are no longer isolated by a
> Supabase `test` schema + migration `0008`. Each environment now has its **own
> Neon branch** (its own `DATABASE_URL`), and config is managed in **Doppler**.

## The three environments

| Env         | Doppler config      | Database              | Status                         |
| ----------- | ------------------- | --------------------- | ------------------------------ |
| **dev**     | `dev`               | Neon `dev` branch     | ✅ in use                       |
| **staging** | `stg`               | Neon `staging` branch | ⚠️ config exists but **empty**  |
| **prod**    | `prd_api` / `prd_web` | Neon `prod` branch  | ✅ synced to Railway            |

Secrets live in Doppler (project **`internal-inventory-app`**), not in committed
`.env` files. The API reads **every** value from `process.env`
(`supabase/api/src/env.ts`); Doppler (or Railway, in prod) injects them at run
time. See [`doppler-env-mapping.md`](doppler-env-mapping.md).

> ⚠️ **Hard isolation.** Unlike the old shared-Supabase-project setup, each env is
> a separate Neon branch — a dev/staging write can never reach prod rows. Neon
> branches are copy-on-write, so `staging`/`dev` can be re-created cheaply from
> `prod`.

## Applying schema changes per environment

There is no auto-migrate on boot. Apply schema to the target env's Neon branch:

- **Fresh branch:** `psql "$DATABASE_URL" -f supabase/api/db/schema.sql`
  (optionally `node supabase/api/db/seed.mjs`).
- **Existing branch with data:** run the idempotent files in
  [`supabase/migrations/`](../supabase/migrations/) — `schema.sql` alone won't add
  columns to already-created tables (e.g. `items.category_id`,
  `items.specification`). All migrations use `if not exists`, so they're re-runnable.

Grab a config's connection string without printing it via
`doppler run --config <cfg> -- psql "$DATABASE_URL" -f <file>`.

## Running an environment

### API (`supabase/api/`)
Preferred — inject the env's secrets from Doppler:

```bash
doppler run --config dev     -- npm run dev     # dev Neon branch
doppler run --config stg     -- npm run dev     # staging (once populated)
doppler run --config prd_api -- npm start       # prod (normally Railway does this)
```

Fallback — `APP_ENV` file layering (no Doppler): `src/env.ts` loads `.env`, then
layers `.env.$APP_ENV` on top (`override: true`). Copy `.env.example` → `.env`
and, for a second env alongside it, `.env.test.example` → `.env.test`:

```bash
npm start            # .env only          (default port 4000)
npm run start:test   # .env + .env.test   (port 4001)
npm run start:prod   # .env + .env.production
# dev (tsx watch): npm run dev / dev:test / dev:prod
```

### Web (`web/`)
The web app only needs `API_URL` (it calls the API server-side). The `start:*`
/ `dev:*` scripts hard-code the matching API URL/port; or set it inline:

```bash
API_URL=http://localhost:4000 npm run dev    # -> serves :3000
npm run dev:test                             # -> API :4001, serves :3001
```

### Mobile (`mobile/`)
Pick the API at launch with `--dart-define` (overrides the bundled `.env`):

```bash
flutter run                                                   # uses .env API_URL
adb reverse tcp:4001 tcp:4001
flutter run --dart-define=API_URL=http://10.0.2.2:4001        # against test API
```

## The automated test "environment" (distinct from the above)

`npm test` (`APP_ENV=test`) is **not** one of the three deploy environments. It
runs the Vitest/Supertest suite against an **isolated `test` schema** that the
harness creates, fills from `db/schema.sql`, and drops afterward — so it can
safely target any database (even dev) without touching `public`.

Two requirements for the test `DATABASE_URL` (see
[`../supabase/api/.env.test.example`](../supabase/api/.env.test.example)):

1. **Unpooled Neon host** (no `-pooler`) — the pooled endpoint rejects the
   `search_path` startup option.
2. Append `?options=-c%20search_path%3Dtest` (or `&options=...`) so both the
   harness and the app pool resolve to the `test` schema.

```bash
cd supabase/api
cp .env.test.example .env.test     # set an unpooled DATABASE_URL + search_path=test
npm test                           # creates schema `test`, runs suite, drops it
```

## How the switch works (no new dependencies)

- **API** — `src/env.ts` reads `process.env`; Doppler (`doppler run --config …`)
  or the `.env` + `.env.$APP_ENV` layering supplies `DATABASE_URL`, `JWT_SECRET`,
  `PORT`, `CORS_ORIGINS`, `MOMO_*`, etc. All queries run raw SQL over the `pg`
  pool in `src/db.ts` against that `DATABASE_URL`. The Google Drive EBM-receipt
  upload (`src/lib/drive.ts`) is the one exception — it reads
  `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` / `GOOGLE_DRIVE_EBM_FOLDER_ID`
  straight from `process.env` rather than through `env.ts`, and has no
  fail-closed guard if they're missing/misconfigured in prod. See
  [`doppler-env-mapping.md`](doppler-env-mapping.md) for the values.
- **Web** — `process.env` wins over `.env*` in Next's load order, so the inline
  `API_URL=…` in each `start:*` / `dev:*` script selects the API (server-side
  reads in `src/lib/api/server.ts` and `src/lib/session-middleware.ts`).
- **Mobile** — `lib/config/api_client.dart` prefers a compile-time
  `String.fromEnvironment('API_URL')`, falling back to `.env`, then the
  `10.0.2.2:4000` emulator default.

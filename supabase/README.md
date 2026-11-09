# Database & API (`supabase/`)

> **The name is legacy.** This directory no longer uses Supabase. The backend was
> re-platformed onto **Neon PostgreSQL** with self-hosted auth; the folder kept
> its name to avoid churn. It now holds the shared **[`api/`](api/README.md)**
> (an Express service) plus the SQL schema, seed script, load tests, and the old
> Supabase migration history (kept for reference only).

The `web/` and `mobile/` apps don't talk to the database directly — they go
through the API, which authenticates each request (its own HS256 JWTs), enforces
authorization in the application layer, and runs raw SQL over a `pg` pool.

## Prerequisites

- A **PostgreSQL** database. We use [Neon](https://neon.tech) — create a project
  and grab the pooled connection string from **Dashboard → Connection Details**.
  Any Postgres 15+ works locally too.

## First-time setup

The schema is a single file — there is no Supabase CLI or Docker stack involved.

```bash
# 1. Apply the schema to your database
psql "$DATABASE_URL" -f api/db/schema.sql

# 2. (optional) Seed demo data
cd api && cp .env.example .env      # set DATABASE_URL + JWT_SECRET
npm install
node db/seed.mjs
```

Then point the apps' env files at the running API (not at the database):

- [`web/.env.local`](../web/.env.example) → `API_URL`
- [`mobile/.env`](../mobile/.env.example) → `API_URL`

## Schema changes

The live schema is [`api/db/schema.sql`](api/db/schema.sql) — edit it there and
re-apply. It is idempotent (`create table if not exists …`), so re-running it is
safe. To reset a dev database, drop and recreate, then re-apply the file and the
seed.

> `migrations/0001…0018` are the **legacy Supabase migration history**. They are
> retained for historical context and are **not** applied to Neon — the
> consolidated `api/db/schema.sql` supersedes them.

### Incremental migrations (`0019+`)

A fresh database only needs `api/db/schema.sql`. An **existing** database needs
the `0019+` files applied on top, one at a time:

```
cd supabase/api
DATABASE_URL=<neon-url> node apply-migration.mjs ../migrations/<file>.sql
```

`apply-migration.mjs` takes one explicit file and keeps no record of what has
run, so **order is manual**. Each file is idempotent, so re-running one is safe.
Apply in exactly this order — two pairs share a number prefix, so alphabetical
sorting is not a reliable guide:

1. `0019_additional_perf_indexes.sql`
2. `0019_add_item_categories.sql`
3. `0020_add_item_specification.sql`
4. `0020_units_per_container.sql`
5. `0021_location_sublocations.sql`
6. `0022_drop_item_description_category.sql` — drops the categories added in (2)
7. `0023_transaction_product_sku_spec.sql`
8. `0024_damaged_stock.sql`
9. `0025_location_stock_message.sql`
10. `0026_lost_and_recorded_by.sql`
11. `0027_item_packages_and_transfer.sql`
12. `0028_heal_stock_capacity.sql` — one-time data correction
13. `0029_location_archive.sql` — `archived_at`, so a used location can be removed
14. `0030_location_name_per_parent.sql` — names unique per parent, not globally
15. `0031_reassign_reason.sql` — the `reassign` ledger reason
16. `0032_password_resets_and_low_stock_alerts.sql` — two tables that existed
    only in `schema.sql` and never had a migration
17. `0033_condition_report.sql` — `items.category`, plus `recommendation` and
    `resolves` on `stock_movements`, for the condition report
18. `0034_item_photo_url.sql` — `items.photo_url`
19. `0035_item_suggestions.sql` — `item_suggestions` table (non-damage
    recommendations, e.g. "upgrade to 16GB RAM"), feeding the condition
    report's Recommendation column alongside fault-based ones
20. `0036_location_photos_and_item_slots.sql` — `locations.photo_url` plus
    per-location item slot numbers
21. `0037_account_approval.sql` — self-registered accounts wait for admin
    approval
22. `0038_password_reset_confirmation.sql` — password resets hold their
    proposed password pending email confirmation

Steps 8, 9, 11 and 15 each replace the `apply_stock_movement()` trigger function
or its reason constraint, so running them out of order leaves the stock engine
on an older definition.

Order matters again at the end: **0030 must follow 0029**. 0029 replaces the
global unique constraint on `locations.name` with a partial index, and 0030
replaces *that* index with the per-parent ones. Running 0030 first leaves the
old global constraint in place, and sub-locations sharing a name with anything
else in the tree keep failing.

**0031 must be applied before the API that writes `reassign` rows starts**, or
every check-in at a location other than the one the units came from fails on the
reason check constraint.

**0033 must be applied before the API that requires a damage reason starts.**
It is additive (three nullable columns), but the damage/repair routes write
`recommendation` and `resolves` on every fault, so without it marking anything
damaged fails.

### Checking what a database already has

`apply-migration.mjs` keeps no record of what has run, so use the checker:

```
cd supabase/api
DATABASE_URL=<neon-url> node verify-schema.mjs
```

It reports `OK` / `MISSING` per migration from `0027` on. SELECTs only, so it is
safe to point at production.

### What to run for the current release

Everything from `0029` on is new. On a database already at `0028`:

```
cd supabase/api
URL=<neon-url>   # use the UNPOOLED host (no `-pooler`) — DDL over the pooled
                 # endpoint is unreliable
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0029_location_archive.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0030_location_name_per_parent.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0031_reassign_reason.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0032_password_resets_and_low_stock_alerts.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0033_condition_report.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0034_item_photo_url.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0035_item_suggestions.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0036_location_photos_and_item_slots.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0037_account_approval.sql
DATABASE_URL=$URL node apply-migration.mjs ../migrations/0038_password_reset_confirmation.sql
```

Each prints `OK: applied …`. All are idempotent, so a re-run is a no-op — if you
are unsure whether an environment already has them, just run them again.

The URL lives in Doppler, so the one-liner that avoids handling it by hand is:

```
DATABASE_URL="$(doppler secrets get DATABASE_URL --plain \
  --project internal-inventory-app --config prd_api | sed 's/-pooler\././')" \
  node apply-migration.mjs ../migrations/<file>.sql
```

The `sed` is what swaps the pooled host for the direct one. Note that only the
`dev`, `dev_personal` and `prd_api` configs carry a `DATABASE_URL` — `stg` and
`prd` have none, so there is no staging database to migrate.

Statuses, verified with `verify-schema.mjs` on 2026-08-13: **dev (Branch-dev)
— 0035, missing 0036–0038. prd — 0038, up to date.** There is no stg database.

### Keeping schema.sql and the migrations in step

`schema.sql` builds a fresh database; the `0019+` files bring an existing one
forward. Nothing enforces that the two agree, and they had already drifted in
both directions:

- `password_resets` and `low_stock_alerts` were added to `schema.sql` only, so
  every existing database lacked them — and the password-reset and low-stock
  features query those tables directly. The test harness rebuilds from
  `schema.sql`, so the suite stayed green while dev/stg/prd would have failed at
  runtime. Fixed by `0032`.
- The `0019` performance indexes were added by migration only, so a fresh
  database (and the test schema) lacked them. Mirrored into `schema.sql`.

**A schema change needs BOTH**: edit `schema.sql` *and* add a migration file. To
prove an environment matches, apply `schema.sql` into a throwaway schema and
diff `information_schema.columns`, `pg_indexes` and `pg_constraint` against the
live one — that is how both gaps above were found.

## Layout

```
supabase/
├── api/            Shared Express API + Neon schema (see api/README.md)
│   └── db/
│       ├── schema.sql   The live database schema (source of truth)
│       └── seed.mjs     Demo-data seed script
├── migrations/     0001–0018 legacy (not applied); 0019+ applied incrementally
├── perf/           k6 load tests + endpoint analyzer (see perf/README.md)
├── snippets/       One-off SQL helpers (grant privileges, clear perf users)
├── config.toml     Legacy Supabase local-stack config — unused
├── seed.sql        Legacy Supabase seed — superseded by api/db/seed.mjs
└── README.md
```

## Schema overview

Auth + app tables (full DDL in [`api/db/schema.sql`](api/db/schema.sql)):

- `users` — auth identity: email, bcrypt `password_hash`, `email_confirmed`.
- `refresh_tokens` — hashed refresh tokens, one per session, with revoke +
  expiry (rotation and per-session logout).
- `profiles` — `id` FK → `users`; display name, role (`admin` / `member`),
  `fallback_role` (`cashier`), `blocked`, and payment limits/permissions.
- `locations` — physical stock locations (stockroom, lab A, etc.).
- `items` — catalog of items.
- `item_stock` — current quantity per `(item, location)`.
- `stock_movements` — append-only check-out / check-in log; a trigger keeps
  `item_stock` in sync on every insert.
- `monthly_budgets` — global corporate-expense allocation per month.
- `corporate_transactions` — expense requests and MoMo disbursements.
- `transaction_products` — cart items attached to a transaction.

Authorization is **not** in the database (no RLS). It is enforced by the API's
Express middleware — see [`../docs/architecture.md`](../docs/architecture.md).

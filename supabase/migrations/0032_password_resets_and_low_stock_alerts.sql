-- 0032_password_resets_and_low_stock_alerts.sql
-- The two tables the E2 (password reset) and E4 (low-stock alert) features
-- query, which existed only in db/schema.sql and never got a migration.
--
-- A fresh database gets them from schema.sql, and the test harness rebuilds
-- from schema.sql too — which is why the suite is green. Every EXISTING
-- database (dev, stg, prd) is migrated incrementally from 0019 onwards and so
-- never received them. The code does not degrade gracefully:
--
--   POST /auth/forgot-password  -> insert into password_resets  -> 42P01
--   POST /auth/reset-password   -> select from password_resets  -> 42P01
--   the low-stock scan          -> select from low_stock_alerts -> 42P01
--
-- Definitions are copied verbatim from db/schema.sql, so applying this leaves
-- an existing database structurally identical to a fresh one.
--
-- Idempotent: safe to re-run.

-- E2: single-use, expiring password-reset tokens.
create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,      -- sha256(raw token)
  expires_at timestamptz not null,
  used_at timestamptz,                  -- null until consumed (single-use)
  created_at timestamptz not null default now()
);
create index if not exists password_resets_user_idx on password_resets (user_id);

-- E4: which (item, location) pairs have already been alerted on, so admins get
-- one email per low-stock event instead of one per scan.
create table if not exists low_stock_alerts (
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  last_alerted_at timestamptz not null default now(),
  primary key (item_id, location_id)
);

# Epic E11 — Neon backups & monitoring (runbook)

The database lives on Neon (`ep-fragrant-sunset-askfqrd9`, eu-central-1). These are
**dashboard actions**, not code changes. Capture proof for the audit trail.

## 1. Backups / PITR
- Neon keeps **branch history** automatically. Confirm PITR is ON:
  Neon dashboard → project → **Settings → Branches → History retention** → set to
  e.g. **7–30 days** (paid plans; Free has limited retention).
- For the production branch (`main`), ensure **"Automated backups" / PITR** is enabled.
- Record the retention window in this file once set.

## 2. Branch protection
- Keep a `main` (prod) branch + a `dev`/preview branch. Never run destructive
  migrations (e.g. `DROP SCHEMA`, `DROP COLUMN`) directly on `main`.
- The test suite uses an isolated `test` schema on the SAME dev DB
  (`search_path=test,public`) — it never touches `public`. The local
  `conftest`/globalSetup `DROP SCHEMA test CASCADE` only drops `test`, not `public`.
  ⚠ Do NOT point tests at Neon `main`/prod.

## 3. Connection string hygiene
- `DATABASE_URL` is a secret (in Doppler `prd_api`, per `docs/doppler-env-mapping.md`).
- Use the **direct** endpoint (`-pooler` stripped, port 5432) for schema/DDL work;
  the pooled endpoint (6543) for app runtime. Both are in `.env`/`.env.test`.
- Monitor active connections in Neon → **Monitoring → Connections**; alert if the
  pool saturates (the API uses a small `max` pool).

## 4. Monitoring / alerts
- Neon → **Monitoring** for CPU, storage, and connection spikes.
- Set a Neon project alert (or Doppler/observability) on:
  - storage > 80%,
  - failed connections / auth errors,
  - sudden row-count drops on `item_stock` / `users`.
- The API logs each request when `MOMO_TARGET_ENV=sandbox` (see `src/http.ts`);
  in prod that's silent — add a real logger/error tracker (Sentry, Railway logs)
  before go-live.

## 5. Restore drill (write once, run never)
- Neon → branch → **Restore** picks a PITR timestamp → creates a new branch.
- Smoke test the restored branch with `GET /health` + a login before promoting.

## Status
- [ ] PITR retention window set: ______ days.
- [ ] `main` branch protected; tests confirmed isolated to `test` schema.
- [ ] Connection monitoring alert created.
- [ ] Restore drill documented above (no action needed unless incident).

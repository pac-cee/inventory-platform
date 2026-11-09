# Deploying

Two services, both on Railway, from one monorepo:

| Service | Platform | Root directory | Live URL |
| ------- | -------- | -------------- | -------- |
| `api`   | Railway  | `supabase/api` | `https://api-production-4a46.up.railway.app` |
| `web`   | Railway  | `web`          | `https://web-production-c3962.up.railway.app` |

The database is **Neon PostgreSQL** — nothing to deploy, but the schema has to be
migrated before an API that depends on new columns goes live. See
[`../supabase/README.md`](../supabase/README.md).

> **There was briefly a second web app on Vercel**
> (`web-beta-olive-82.vercel.app`), and this document asserted it was the
> canonical one. It was not. Two Next.js deployments were live against the same
> production database, and `CORS_ORIGINS` / `RESET_URL_BASE` pointed at the
> Vercel one — so password-reset and email-verification links sent users to an
> origin where their session did not exist. Railway is canonical; the Vercel
> project has been retired. `web/vercel.json` is now the leftover file, not
> `web/railway.json`.
>
> This table has been wrong twice, in both directions. Before trusting it, check
> a response header: Railway sends `server: railway-hikari` and
> `x-railway-edge`, Vercel sends `x-vercel-id`.

## How traffic flows

```
browser ──▶ web (Railway, Next.js server) ──▶ api (Railway) ──▶ Neon
```

Keeping `web` and `api` on the same platform matters for latency: the
server-side call between them stays within Railway rather than crossing a
provider boundary. When `web` was on Vercel its functions ran in `iad1`
(Virginia) while the API and database were in Europe, so every server-side API
call — and the user's page load with it — made a transatlantic round trip.

**The browser never calls the API.** `API_URL` appears in exactly three
server-side places — `web/src/lib/api/server.ts`,
`web/src/lib/session-middleware.ts`, and the
`web/src/app/api/payments/reports/export/route.ts` route handler — and no client
component fetches the API. Every call is the Next.js server calling Railway.

This matters because **CORS is not on the web app's path**. Browsers enforce
CORS; server-side `fetch` ignores it. `CORS_ORIGINS` is still worth keeping
correct — the mobile app calls the API directly, and anything that starts
fetching from a browser would need it — but a CORS rejection is never the
explanation for the web app failing to reach the API.

## Deploying the API (Railway)

Railway builds from `supabase/api/railway.json`: NIXPACKS, `npm run build`,
`npm start`, healthcheck on `/health` with a 100s timeout. A build that fails its
healthcheck rolls back instead of going live.

**"Redeploy" does not pick up new code.** It re-runs the commit that is already
deployed. Shipping new commits needs a *new* deployment from the branch tip:

1. Railway → project → the **`api`** service
2. **Settings → Source** — confirm which branch is connected, and whether
   auto-deploy is on
3. **Deployments → Deploy** (the button at the top — not "Redeploy" on an
   existing entry)

A merge to `main` has silently failed to trigger a build before, so do not assume
merging deployed anything. Verify.

### Verifying which build is live

Every router except `/auth` answers `401` to an unauthenticated request, because
`requireAuth` is mounted on the router and runs before route matching. Two
consequences:

- A **new router** is detectable from outside: it flips `404` → `401`.
- A **new route inside an existing router** is not. `/movements/anything` returns
  `401` whether or not the route exists — do not read that as proof of anything.

So the check is per-router:

```bash
API=https://api-production-4a46.up.railway.app
for r in auth profiles users locations items stock movements payments reports admin; do
  printf '%-12s %s\n' "/$r" "$(curl -s -o /dev/null -w '%{http_code}' $API/$r/zz-probe)"
done
```

All should be `401` except `/auth`, which is `404`. A `404` anywhere else means
that router is missing and the build predates the commit that added it. The
condition report added `/reports`, so it is the current marker:

```bash
curl -o /dev/null -w '%{http_code}\n' $API/reports/categories
# 401 = new code is live    404 = stale build
```

## Deploying the web app (Railway)

Same service model as the API — Railway builds `web/` from `web/railway.json`
(NIXPACKS, `npm run build`, `npm start`). The **Deploy vs Redeploy** distinction
above applies here too.

**`API_URL` is baked in at build time.** Saving the variable without rebuilding
changes nothing — redeploy after editing it. If it is unset the app falls back to
`http://localhost:4000` and every server-side call fails.

The web app cannot be checked from outside the way the API can. Every route
redirects to `/login` without a session — including routes that do not exist —
so a `307` proves nothing about which build is live, and the login page's chunks
do not carry the reports code. Log in and look at the feature itself.

## Configuration

Secrets live in **Doppler** (project `internal-inventory-app`), not in the
platform dashboards. Configs: `dev`, `dev_personal`, `stg`, `prd`, `prd_api`.
Only `prd_api` holds the production API's variables — `prd` has just Doppler
metadata, and `stg` has no `DATABASE_URL` at all, so **there is no staging
database**.

### `api` (Doppler `prd_api`)

| Variable | Notes |
| -------- | ----- |
| `DATABASE_URL` | Neon connection string. Pooled is right for the app; use the **unpooled** host for DDL — see `supabase/README.md`. |
| `JWT_SECRET` | Signs the API's own HS256 tokens. Required; the API refuses to start without it. |
| `CORS_ORIGINS` | Comma-separated. **Required in production**: `src/env.ts` refuses to boot if this is `*` while `NODE_ENV=production`, because `app.ts` reflects the wildcard with `credentials: true` — an open credentialed relay. Not on the web app's request path, but it must still be set to something explicit. |
| `RESET_URL_BASE` | Origin for emailed links — the **web** app, not the API. |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Resend. The mailer no-ops when blank, so password reset silently does nothing without them. |
| `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER`, `MOMO_API_KEY`, `MOMO_TARGET_ENV` | All four required in production — `assertMoMoConfigured()` refuses to boot otherwise, so a mock-mode deploy cannot "complete" payments that moved no money. |
| `NODE_ENV` | `production`. Arms both fail-closed guards above. |

Do **not** set `PORT` — Railway injects it and `env.ts` reads it.

Optional: `ACCESS_TOKEN_TTL` (default 1h), `REFRESH_TOKEN_TTL` (default 30d),
`MOMO_CURRENCY` (default `RWF`), `MOMO_MODE` (`demo` forces mock MoMo — explicit
opt-in, and it does not bypass the production guard above).

### `web` (Railway)

| Variable | Value |
| -------- | ----- |
| `API_URL` | `https://api-production-4a46.up.railway.app` |

### Doppler is live — no redeploy needed for a variable change

Changing a value in Doppler `prd_api` reaches the running API without a rebuild:
setting `CORS_ORIGINS` to the Railway origin flipped a preflight from rejected
to allowed on the next request. Do not assume a config change needs a deploy —
check first, because a needless redeploy makes it look like the deploy fixed it.

`API_URL` is the exception, and it is a build-time bake, not a Doppler
behaviour: Next.js inlines it during `npm run build`.

### Previously wrong, now fixed

`RESET_URL_BASE` was `https://web-beta-olive-82.vercel.app.` — the retired
Vercel origin, *and* with a trailing dot. Both halves broke emailed links:
`webBaseUrl()` in `src/auth-service.ts` only `.trim()`s, so the dot survived
into every link and a trailing-dot host fails TLS certificate matching, while
the origin itself pointed at an app where the recipient had no session. It
governs **email verification as well as password reset**, so new signups were
affected too. Both are now the Railway origin.

## Release checklist

1. **Migrate the database first.** `cd supabase/api && node verify-schema.mjs`
   against prd should print "Up to date" before the new API starts. An API that
   writes columns the database lacks fails at runtime, not at boot — so a green
   healthcheck proves nothing about it.
2. Deploy the `api` service, then confirm with the per-router probe above.
3. Redeploy `web` on Railway — including after any `API_URL` change, which is
   baked in at build time.
4. `https://<api>/health` → `{"status":"ok","service":"inventory-api"}`
5. `https://<web>/` → redirects to `/login`
6. Log in and confirm the feature you shipped is actually visible.

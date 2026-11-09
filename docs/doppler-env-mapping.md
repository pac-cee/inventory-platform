# Epic E7 — Doppler env provenance (`prd_api`)

The API reads **every** config value from `process.env` (see `supabase/api/src/env.ts`).
Railway injects these at deploy (see `docs/railway-deploy.md`). To move prod
secrets out of the Railway dashboard and into **Doppler**, create a Doppler
project + config named `prd_api` and store the keys below, then point Railway's
`api` service at Doppler (Railway → Variables → "Import from Doppler" or the
Doppler Railway integration). Nothing in `env.ts` changes — Doppler just becomes
the source of the env vars at runtime.

## Mapping: local `.env` key → Doppler `prd_api` key

| Doppler key (prd_api)        | Local `.env` key            | Secret? | Notes                                                |
| ---------------------------- | --------------------------- | ------- | ---------------------------------------------------- |
| `DATABASE_URL`               | `DATABASE_URL`              | yes     | Direct Neon URL (no `-pooler`) in prod is fine; pooler also works. |
| `JWT_SECRET`                 | `JWT_SECRET`                | yes     | HS256 signing key. Must match what signed existing tokens. |
| `SUPABASE_URL`               | `SUPABASE_URL`              | config  | From the Supabase project.                          |
| `SUPABASE_ANON_KEY`          | `SUPABASE_ANON_KEY`         | config  | Public anon key.                                    |
| `SUPABASE_SERVICE_ROLE_KEY`  | `SUPABASE_SERVICE_ROLE_KEY` | yes     | Server-only; never ship to client/mobile.           |
| `EMAIL_API_KEY`              | `EMAIL_API_KEY`             | yes     | Resend key (`re_…`).                                |
| `EMAIL_FROM`                 | `EMAIL_FROM`                | config  | e.g. `noreply@mail.verlet.co`.                      |
| `MOMO_SUBSCRIPTION_KEY`      | `MOMO_SUBSCRIPTION_KEY`     | yes     | MTN MoMo (E6). Required in prod — fails closed if missing. |
| `MOMO_API_USER`              | `MOMO_API_USER`             | yes     | Often auto-provisioned from sub key; set if pre-provisioned. |
| `MOMO_API_KEY`               | `MOMO_API_KEY`              | yes     | Often auto-provisioned; set if pre-provisioned.     |
| `MOMO_TARGET_ENV`            | `MOMO_TARGET_ENV`           | config  | `mtnrwanda` (prod) or `sandbox` (test).             |
| `MOMO_CURRENCY`              | `MOMO_CURRENCY`             | config  | Defaults to `RWF` if absent.                        |
| `CORS_ORIGINS`               | `CORS_ORIGINS`              | config  | Comma-separated explicit origins. `*` is REJECTED in prod by the fail-closed guard. |
| `RESET_URL_BASE`             | `RESET_URL_BASE`            | config  | Web origin for reset/verify links (default `http://localhost:3000`). |
| `GOOGLE_OAUTH_CLIENT_ID`     | `GOOGLE_OAUTH_CLIENT_ID`    | config  | OAuth client used to upload EBM receipts to Drive (`src/lib/drive.ts`). Read directly via `process.env`, not `env.ts`. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_SECRET`| yes     | Paired with the client ID above. |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | `GOOGLE_OAUTH_REFRESH_TOKEN`| yes     | One-time consent token for the Google account Drive uploads run as. Get it via `node get-drive-refresh-token.mjs` (see `supabase/api/README.md`). Auth is OAuth-as-a-real-account, not a service account — service accounts have no Drive storage quota, and the Shared Drive workaround requires Google Workspace. |
| `GOOGLE_DRIVE_EBM_FOLDER_ID` | `GOOGLE_DRIVE_EBM_FOLDER_ID`| config  | Drive folder receipts upload into (must be a regular folder owned by, or shared with, the OAuth account above). Falls back to a folder ID hardcoded in `drive.ts` if unset — set explicitly in every real environment. |

## Things to verify when wiring Doppler
- The fail-closed guards in `env.ts` will **refuse to boot** in production if
  `MOMO_SUBSCRIPTION_KEY` or `CORS_ORIGINS=*` is wrong — that's intended (E6/E10).
- `JWT_SECRET` must stay stable across deploys or all existing sessions invalidate.
- The `web` service only needs `API_URL` (Railway auto-ref `${{api.RAILWAY_PUBLIC_DOMAIN}}`);
  it does NOT need the secret keys above.
- Add a `doppler.yaml` at repo root pointing at the `prd_api` config for local
  `doppler run -- npm start` if desired, but the deploy path is Railway→Doppler.

## Status
- [ ] Doppler project + `prd_api` config created (user, in Doppler dashboard).
- [ ] Keys above entered (values from local `.env` / Supabase / MTN MoMo portal).
- [ ] Railway `api` service imports from Doppler.
- [ ] `npm start` on a staging deploy boots with no "Refusing to start" guard errors.

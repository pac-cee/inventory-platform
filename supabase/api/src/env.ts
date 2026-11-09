import { config as loadDotenv } from "dotenv";

// Base secrets live in `.env`. When APP_ENV is set (e.g. `APP_ENV=test`), the
// matching `.env.<APP_ENV>` file is layered on top and overrides PORT /
// CORS_ORIGINS / DATABASE_URL for that environment.
loadDotenv();
if (process.env.APP_ENV) {
  loadDotenv({ path: `.env.${process.env.APP_ENV}`, override: true });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Copy supabase/api/.env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

export const env = {
  // Neon (or any) PostgreSQL connection string.
  databaseUrl: required("DATABASE_URL"),
  // Secret used to sign/verify the API's own HS256 access tokens.
  jwtSecret: required("JWT_SECRET"),
  // Access token lifetime (seconds). Clients refresh ~1 min before expiry.
  accessTokenTtl: Number(process.env.ACCESS_TOKEN_TTL ?? 60 * 60),
  // Refresh token lifetime (seconds). Default 30 days.
  refreshTokenTtl: Number(process.env.REFRESH_TOKEN_TTL ?? 60 * 60 * 24 * 30),
  port: Number(process.env.PORT ?? 4000),
  // Which Postgres schema to read. `public` everywhere except the test
  // harness, which builds an isolated `test` schema. Stated explicitly because
  // Neon's pooler leaks `search_path` between clients — see db.ts.
  dbSchema: process.env.DB_SCHEMA?.trim() || "public",
  corsOrigins: (process.env.CORS_ORIGINS ?? "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  momoApiKey: process.env.MOMO_API_KEY?.trim() || "",
  momoTargetEnv: process.env.MOMO_TARGET_ENV?.trim() || "",
  momoApiUser: process.env.MOMO_API_USER?.trim() || "",
  // Public https address MTN calls back to (host must equal the "Provider callback host"
  // registered for the API user). Empty = no callback is requested; the reconciler settles.
  momoCallbackBaseUrl: (process.env.MOMO_CALLBACK_BASE_URL?.trim() || "").replace(/\/+$/, ""),
  // MTN API host. Sandbox by default; production is https://proxy.momoapi.mtn.com.
  momoBaseUrl: (process.env.MOMO_BASE_URL?.trim() || "https://sandbox.momodeveloper.mtn.com").replace(/\/+$/, ""),
  // Country code added to a local number that starts with 0 (Rwanda = 250).
  momoCountryCode: process.env.MOMO_COUNTRY_CODE?.trim() || "250",
  momoSubscriptionKey: process.env.MOMO_SUBSCRIPTION_KEY?.trim() || "",
  // Transactional email (Resend). Optional locally — mailer no-ops when blank.
  // Required in production: set EMAIL_API_KEY + EMAIL_FROM in Doppler prd_api.
  emailApiKey: process.env.EMAIL_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM?.trim() || "",
  // MoMo disbursement currency. Defaults to RWF (Rwanda); override via
  // MOMO_CURRENCY if a different sandbox/product currency is needed.
  momoCurrency: process.env.MOMO_CURRENCY?.trim() || "RWF",
  // Demo mode: when set to "demo", MoMo runs in mock (deterministic SUCCESSFUL)
  // even with real keys present. Intended for demos/testing where you want the
  // full payment flow without depending on MTN sandbox. Explicit opt-in only —
  // it does NOT bypass the prod "subscription key required" guard.
  momoMode: process.env.MOMO_MODE?.trim() || "",
  // UrubutoPay (BK's payment-gateway product) — used for BK-method payment
  // requests (bulk disbursement). Leave blank to run BK requests in MOCK
  // mode. Replaces the old direct "Banking as a Service" sandbox integration.
  urubutopayApiKey: process.env.URUBUTOPAY_API_KEY?.trim() || "",
  urubutopayBaseUrl: process.env.URUBUTOPAY_BASE_URL?.trim() || "https://staging.urubutopay.rw",
  // The company's UrubutoPay Merchant Wallet id — required for real
  // disbursement/balance calls, funded via the UrubutoPay merchant portal
  // (topped up from the real BK account; not an API call this app makes).
  urubutopayWalletAccountId: process.env.URUBUTOPAY_WALLET_ACCOUNT_ID?.trim() || "",
  // Demo mode: same contract as MOMO_MODE — forces deterministic mock even
  // with real keys present. Does NOT bypass the prod key guard below.
  urubutopayMode: process.env.URUBUTOPAY_MODE?.trim() || "",
  // Which header carries the API key: "authorization" (spec prose) or
  // "x-api-key" (spec securityScheme). The spec contradicts itself; confirm
  // with the first real call.
  // Credentials UrubutoPay presents to OUR callback-auth endpoint
  // (POST /webhooks/urubutopay/auth) to get a Bearer token for its callbacks.
  // We choose them and hand them to UrubutoPay at organisation setup.
  urubutopayWebhookUser: process.env.URUBUTOPAY_WEBHOOK_USER?.trim() || "",
  urubutopayWebhookPassword: process.env.URUBUTOPAY_WEBHOOK_PASSWORD?.trim() || "",
  urubutopayAuthHeader: process.env.URUBUTOPAY_AUTH_HEADER?.trim() || "Authorization",
};

// ---------------------------------------------------------------------------
// CORS fail-closed guard (E10 hardening, landed early).
//
// `corsOrigins` defaults to "*" for local dev convenience. But `app.ts` reflects
// that wildcard with `credentials: true`, which is an open credentialed relay in
// production. Refuse to boot if a wildcard origin is configured where it matters.
// Operators MUST set explicit, comma-separated origins in Doppler prd_api /
// .env.production before a production deploy.
// ---------------------------------------------------------------------------
const _isProd =
  process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
if (_isProd && env.corsOrigins.includes("*")) {
  throw new Error(
    "Refusing to start: CORS_ORIGINS is '*' in production. " +
      "Set explicit origins (comma-separated) in Doppler prd_api / .env.production.",
  );
}

// ---------------------------------------------------------------------------
// MoMo fail-closed guard (E6 hardening).
//
// In production the disbursement path MUST be real — running mock mode in prod
// would "complete" corporate payments with no actual money moved. Refuse to
// boot unless MOMO_SUBSCRIPTION_KEY is set. Dev may stay in mock mode.
// ---------------------------------------------------------------------------
export function assertMoMoConfigured(
  isProd: boolean,
  subscriptionKey: string,
  apiUser: string,
  apiKey: string,
  targetEnv: string,
): void {
  if (!isProd) return;
  const missing = [
    ["MOMO_SUBSCRIPTION_KEY", subscriptionKey],
    ["MOMO_API_USER", apiUser],
    ["MOMO_API_KEY", apiKey],
    ["MOMO_TARGET_ENV", targetEnv],
  ]
    .filter(([, v]) => !v || !v.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      "Refusing to start: MTN MoMo is not fully configured (missing: " +
        missing.join(", ") +
        "). Set them in Doppler prd_api / .env.production before a production deploy.",
    );
  }
}

assertMoMoConfigured(
  _isProd,
  env.momoSubscriptionKey,
  env.momoApiUser,
  env.momoApiKey,
  env.momoTargetEnv,
);

// ---------------------------------------------------------------------------
// UrubutoPay fail-closed guard, same contract as the MoMo one above:
// production must run against the real UrubutoPay API, never mock mode. Dev
// may stay in mock mode. Callback auth credentials are optional at startup;
// without them, the webhook handler rejects callbacks until they are configured.
// ---------------------------------------------------------------------------
export function assertUrubutopayConfigured(
  isProd: boolean,
  apiKey: string,
  baseUrl: string,
  walletAccountId: string,
): void {
  if (!isProd) return;
  const missing = [
    ["URUBUTOPAY_API_KEY", apiKey],
    ["URUBUTOPAY_BASE_URL", baseUrl],
    ["URUBUTOPAY_WALLET_ACCOUNT_ID", walletAccountId],
  ]
    .filter(([, v]) => !v || !v.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      "Refusing to start: UrubutoPay is not fully configured (missing: " +
        missing.join(", ") +
        "). Set them in Doppler prd_api / .env.production before a production deploy.",
    );
  }
}

assertUrubutopayConfigured(
  _isProd,
  env.urubutopayApiKey,
  env.urubutopayBaseUrl,
  env.urubutopayWalletAccountId,
);

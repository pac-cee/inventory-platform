// Raw fetch wrappers for UrubutoPay's Bulk Disbursement API. This is the
// only file that knows the literal URL paths/headers. Auth is a single
// static API key (no session/token lifecycle, unlike the old bankingAsService
// integration this replaces).
//
// Spec quirks this file absorbs (verified against the live Swagger, which
// contradicts itself in places):
//   - Auth header: the securityScheme says `x-api-key`, every endpoint's prose
//     says `Authorization`. Configurable via URUBUTOPAY_AUTH_HEADER until a
//     real key proves which one the server honours.
//   - Success envelope: some examples carry `success: true`, others
//     `status: 200` (number or string). isSuccessBody() accepts either.
//   - Paths live under /api (staging.urubutopay.rw/api/v2/...); without it the
//     host serves an HTML 404 page.
import type {
  InitiateDisbursementRequest,
  InitiateDisbursementResponse,
  CheckTransferStatusResponse,
  WalletBalanceResponse,
} from "./types.js";

// Thrown when we cannot know whether UrubutoPay accepted the request: the call
// timed out, the network dropped, or the server answered 5xx / non-JSON. The
// money may or may not have moved, so callers must NOT mark the payment failed
// or refund the budget — hold it as 'processing' for reconciliation.
// A plain Error from this module means a definite rejection (safe to refund).
export class UrubutoUnknownOutcomeError extends Error {
  readonly unknownOutcome = true;
  constructor(message: string) {
    super(message);
    this.name = "UrubutoUnknownOutcomeError";
  }
}

export interface UrubutoClientConfig {
  baseUrl: string;
  apiKey: string;
  // "authorization" (default) or "x-api-key".
  authHeader?: string;
}

export function apiRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
}

function authHeaders(cfg: UrubutoClientConfig): Record<string, string> {
  return {
    [cfg.authHeader || "Authorization"]: cfg.apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// True when the body says "ok" in either envelope the spec uses.
export function isSuccessBody(body: { success?: unknown; status?: unknown } | null | undefined): boolean {
  if (!body) return false;
  if (body.success === true) return true;
  if (body.success === false) return false;
  return Number(body.status) === 200;
}

async function post<T>(cfg: UrubutoClientConfig, path: string, payload: unknown): Promise<{ httpStatus: number; body: T | null }> {
  const url = `${apiRoot(cfg.baseUrl)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: authHeaders(cfg),
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    console.error(`[UrubutoPay] POST ${path} -> no response (${err?.name ?? "error"}: ${err?.message ?? err})`);
    throw new UrubutoUnknownOutcomeError(`UrubutoPay ${path}: no response (${err?.name ?? "error"})`);
  }
  // Never assume JSON: a wrong path/IP block can return an HTML page.
  const text = await res.text();
  let body: T | null = null;
  try {
    body = JSON.parse(text) as T;
  } catch {
    /* non-JSON body */
  }
  console.log(`[UrubutoPay] POST ${path} -> HTTP ${res.status}${body ? "" : " (non-JSON body)"}`);
  return { httpStatus: res.status, body };
}

function describe(body: { message?: string } | null, httpStatus: number): string {
  return `HTTP ${httpStatus} — ${body?.message ?? "no message"}`;
}

export async function initiateBulkDisbursement(
  cfg: UrubutoClientConfig,
  body: InitiateDisbursementRequest,
): Promise<InitiateDisbursementResponse> {
  const { httpStatus, body: result } = await post<InitiateDisbursementResponse>(cfg, "/v2/bulk-disbursement/initiate", body);
  // 5xx or an unparseable body: the request may have been processed.
  if (httpStatus >= 500 || !result) {
    throw new UrubutoUnknownOutcomeError(`UrubutoPay disbursement initiate: unclear outcome, HTTP ${httpStatus}`);
  }
  if (httpStatus < 200 || httpStatus >= 300 || !isSuccessBody(result)) {
    throw new Error(`UrubutoPay disbursement initiate rejected: ${describe(result, httpStatus)}`);
  }
  if (!result.data?.internal_transaction_ref_number) {
    // Accepted, but without this ref we can never check the transfer later.
    throw new UrubutoUnknownOutcomeError("UrubutoPay disbursement initiate succeeded but returned no internal_transaction_ref_number");
  }
  return result;
}

export async function checkTransfer(
  cfg: UrubutoClientConfig,
  internalTransactionRefNumber: string,
  beneficiaryCode: string,
): Promise<CheckTransferStatusResponse> {
  const { httpStatus, body } = await post<CheckTransferStatusResponse>(cfg, "/v2/bulk-disbursement/check-transfer", {
    internal_transaction_ref_number: internalTransactionRefNumber,
    beneficiary_code: beneficiaryCode,
  });
  if (!body) {
    throw new Error(`UrubutoPay check-transfer failed: HTTP ${httpStatus} (non-JSON body)`);
  }
  return body;
}

export async function getWalletBalance(
  cfg: UrubutoClientConfig,
  walletAccountId: string,
): Promise<WalletBalanceResponse> {
  // Spec: wallet_account_id is only needed when the org owns several wallets.
  const { httpStatus, body } = await post<WalletBalanceResponse>(
    cfg,
    "/v2/wallet/balance",
    walletAccountId ? { wallet_account_id: walletAccountId } : {},
  );
  if (httpStatus < 200 || httpStatus >= 300 || !body?.data) {
    throw new Error(`UrubutoPay wallet balance failed: ${describe(body, httpStatus)}`);
  }
  return body;
}

/**
 * What MTN's error answers mean, from MTN's own "Common Error Codes" page
 * (Crucial_Docs/MTN, saved 2026-11-02). Pure, so it can be tested.
 *
 * The one thing that is NOT obvious from the HTTP status: several DEFINITE
 * rejections — nothing was created, nothing was paid — arrive as HTTP 500 with a
 * named code. They must not be treated like a 500 that might have paid.
 */

/** 500 codes that mean "refused before processing": safe to fail and refund. */
export const DEFINITE_REJECTION_CODES = new Set([
  "NOT_ALLOWED",
  "NOT_ALLOWED_TARGET_ENVIRONMENT",
  "INVALID_CALLBACK_URL_HOST",
  "INVALID_CURRENCY",
]);

const KNOWN_CODES = [
  "NOT_ALLOWED_TARGET_ENVIRONMENT", // before NOT_ALLOWED: it contains it
  "NOT_ALLOWED",
  "INVALID_CALLBACK_URL_HOST",
  "INVALID_CURRENCY",
  "RESOURCE_ALREADY_EXIST",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_PROCESSING_ERROR",
  "PAYEE_NOT_FOUND",
  "PAYER_NOT_FOUND",
  "COULD_NOT_PERFORM_TRANSACTION",
];

/** The MTN error code in a response body, whatever shape the JSON has. */
export function extractMoMoErrorCode(body: string | null | undefined): string | null {
  const text = String(body ?? "");
  if (!text) return null;
  for (const c of KNOWN_CODES) if (new RegExp(`\\b${c}\\b`).test(text)) return c;
  try {
    const j = JSON.parse(text) as any;
    const c = j?.code ?? j?.error?.code ?? j?.errorCode;
    return typeof c === "string" && c ? c : null;
  } catch {
    return null;
  }
}

const BY_CODE: Record<string, string> = {
  NOT_ALLOWED:
    "The MTN account is restricted, so it is not allowed to make this payment. Contact your MTN account manager.",
  NOT_ALLOWED_TARGET_ENVIRONMENT:
    "MOMO_TARGET_ENV is wrong for this account. Rwanda is `mtnrwanda`; the test environment is `sandbox`.",
  INVALID_CALLBACK_URL_HOST:
    "The callback address does not use the host registered for the API user. Make MOMO_CALLBACK_BASE_URL use exactly that host (a hostname, not an IP address), or leave it empty.",
  INVALID_CURRENCY:
    "The currency is not supported by this MTN account or environment. The sandbox accepts EUR; Rwanda production uses RWF. Check MOMO_CURRENCY.",
};

const BY_STATUS: Record<number, string> = {
  400: "MTN rejected the request as malformed. Check the phone number format (country code, digits only), the currency, and that no note contains special characters such as an apostrophe.",
  401: "MTN rejected the credentials. Check the Disbursement subscription key (Collection, Disbursement and Remittance each have their own key; try the secondary key) and the API user and key.",
  403: "MTN refused this server's IP address. The Disbursement API only accepts calls from IP addresses MTN has allowed: send the server's public outbound IP to your MTN account manager.",
  404: "MTN has no record of that reference or resource.",
  429: "MTN is rate-limiting requests. Try again shortly.",
};

/** A readable sentence for a rejected request, with what to do about it. */
export function describeMoMoError(httpStatus: number, code: string | null, what = "transfer"): string {
  const why = (code && BY_CODE[code]) || BY_STATUS[httpStatus] || "MTN refused the request.";
  return `MoMo ${what} rejected (${httpStatus}${code ? ` ${code}` : ""}): ${why}`;
}

const BY_REASON: Record<string, string> = {
  INTERNAL_PROCESSING_ERROR:
    "MTN could not complete the payment. This is most often insufficient funds in the paying wallet (check the balance), or MTN's wallet platform being unavailable. Try again; if it keeps happening with enough funds, contact your MTN account manager.",
  PAYEE_NOT_FOUND:
    "The recipient's phone number is not valid for mobile money: it must include the country code and be registered for MoMo.",
  PAYER_NOT_FOUND: "The paying number is not valid for mobile money.",
  COULD_NOT_PERFORM_TRANSACTION:
    "The transaction timed out before it was approved. Ask the person to try again and approve within 5 minutes.",
};

/** A readable sentence for the failure reason MTN reports on a FAILED status, or null if unknown. */
export function describeMoMoReason(code: string | null | undefined): string | null {
  return (code && BY_REASON[code]) || null;
}

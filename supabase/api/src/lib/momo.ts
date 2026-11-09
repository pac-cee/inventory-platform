import crypto from "crypto"
import { env } from "../env.js"
import { DEFINITE_REJECTION_CODES, describeMoMoError, extractMoMoErrorCode } from "./momoErrors.js"

interface MoMoTransferPayload {
    amount: string;
    currency: string;
    externalId: string;
    payee: {
        partyIdType: "MSISDN";
        partyId: string;
    };
    payerMessage?: string;
    payeeNote?: string;
}

export interface MoMoTransferStatusResponse {
    financialTransactionId?: string;
    status: "PENDING" | "SUCCESSFUL" | "FAILED";
    reason?: {
        code: string;
        message: string;
    };
    // True when MTN answered 404: it has no record of this reference. The status
    // is reported as PENDING on purpose — "no record" is NOT proof that nothing
    // was paid (the answer may be lagging), so callers must not refund on it.
    notFound?: boolean;
}

/**
 * The request may or may not have reached MTN (timeout, dropped connection, 5xx).
 * The money may have moved, so the payment must be held, never refunded.
 */
export class MoMoUnknownOutcomeError extends Error {
    readonly unknownOutcome = true as const;
    constructor(message: string) {
        super(message);
        this.name = "MoMoUnknownOutcomeError";
    }
}

/** MTN answered and refused the request, so nothing was created: safe to refund. */
export class MoMoRejectedError extends Error {
    constructor(message: string, readonly httpStatus: number) {
        super(message);
        this.name = "MoMoRejectedError";
    }
}

// MTN requires X-Reference-Id to be a UUID *version 4*; anything else is a 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A phone number as MTN wants it: digits only, with the country code (E.164
 * without the plus). "+250 788 123 456" and "0788123456" both become
 * "250788123456". A number that already has a country code, or that is not a
 * local 0-number (sandbox test numbers, for example), is left as it is.
 */
export function normalizeMsisdn(raw: string, countryCode: string = env.momoCountryCode): string {
    let digits = String(raw ?? "").replace(/[^\d]/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("0") && digits.length === 10) digits = countryCode + digits.slice(1);
    return digits;
}

/**
 * The address MTN is asked to call back for one payment, or null for none. MTN only
 * accepts https, and the host must be the "Provider callback host" registered for
 * the API user; we put the payment's own reference in the path so the handler knows
 * which payment to look up WITHOUT trusting anything in the callback body.
 */
export function mtnCallbackUrl(baseUrl: string, referenceId: string): string | null {
    const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) return null;
    if (!/^https:\/\/[^/\s]+$/i.test(base)) {
        console.warn(`[MTN MoMo] MOMO_CALLBACK_BASE_URL must be an https origin with no path (got "${base}") — no callback will be requested`);
        return null;
    }
    return `${base}/webhooks/mtn/${referenceId}`;
}

export interface MoMoConfig {
    subscriptionKey: string;
    apiUser: string;
    apiKey: string;
    targetEnv: string;
    baseUrl: string;
    currency: string;
    mode: string;
    /** https origin MTN should call back to; empty = ask for no callback. */
    callbackBaseUrl: string;
    /** Fetch the token as soon as the client is built. Tests turn this off. */
    warm: boolean;
}

export class MoMoClient {
    private subscriptionKey: string;
    private apiUser: string;
    private apiKey: string;
    private targetEnv: string;
    private baseUrl: string;
    private currency: string;
    private callbackBaseUrl: string;
    private isMock = false;

    // Cached tokens. In-flight promises prevent concurrent refreshes on startup.
    private disbursementToken: string | null = null;
    private disbursementRefreshing: Promise<void> | null = null;
    private collectionToken: string | null = null;
    private collectionRefreshing: Promise<void> | null = null;

    constructor(cfg: Partial<MoMoConfig> = {}) {
        this.subscriptionKey = cfg.subscriptionKey ?? env.momoSubscriptionKey;
        this.apiUser = cfg.apiUser ?? env.momoApiUser;
        this.apiKey = cfg.apiKey ?? env.momoApiKey;
        this.targetEnv = cfg.targetEnv ?? env.momoTargetEnv;
        this.baseUrl = (cfg.baseUrl ?? env.momoBaseUrl).replace(/\/+$/, "");
        this.currency = cfg.currency ?? env.momoCurrency;
        this.callbackBaseUrl = (cfg.callbackBaseUrl ?? env.momoCallbackBaseUrl).replace(/\/+$/, "");
        const mode = cfg.mode ?? env.momoMode;

        if (!this.subscriptionKey) {
            console.warn("[MTN MoMo] No MOMO_SUBSCRIPTION_KEY found. Running in MOCK mode")
            this.isMock = true
            return;
        }

        // Explicit demo mode: force mock even with real keys present, so the
        // full payment flow shows SUCCESSFUL deterministically (boss demo,
        // sandbox flakiness avoidance). Does not bypass the prod key guard.
        if (mode === "demo") {
            console.warn("[MTN MoMo] MOMO_MODE=demo — running in deterministic MOCK mode (no real disbursement)")
            this.isMock = true
            return;
        }

        const sandbox = this.baseUrl.includes("sandbox")
        if (sandbox) {
            console.warn(`[MTN MoMo] Using the SANDBOX (${this.baseUrl}). Real payments need the production base URL, production credentials and MOMO_TARGET_ENV=mtnrwanda.`)
        }
        // A mismatch here makes every transfer fail with NOT_ALLOWED_TARGET_ENVIRONMENT or INVALID_CURRENCY.
        if (sandbox && this.targetEnv && this.targetEnv !== "sandbox") {
            console.warn(`[MTN MoMo] The sandbox needs X-Target-Environment "sandbox", but MOMO_TARGET_ENV is "${this.targetEnv}".`)
        }
        if (!sandbox && this.targetEnv === "sandbox") {
            console.warn(`[MTN MoMo] A production base URL with MOMO_TARGET_ENV=sandbox will be refused: Rwanda is "mtnrwanda".`)
        }
        if (sandbox && this.currency !== "EUR") {
            console.warn(`[MTN MoMo] The sandbox only accepts EUR, but MOMO_CURRENCY is "${this.currency}" — transfers will fail with INVALID_CURRENCY.`)
        }

        // Eagerly warm up the disbursement token so the first real request pays no fetch cost.
        if (cfg.warm ?? true) {
            this.disbursementRefreshing = this.refreshDisbursementToken()
                .finally(() => { this.disbursementRefreshing = null });
            // A failed warm-up is retried on first use; do not let it become an unhandled rejection.
            this.disbursementRefreshing.catch(() => {});
        }
    }

    async provisionSandbox(): Promise<void> {
        if (this.isMock) return
        if (this.apiUser && this.apiKey) return;

        try {
            console.log("[MTN MoMo] Provisioning Sandbox API User...")
            const uuid = crypto.randomUUID()

            const createRes = await fetch(`${this.baseUrl}/v1_0/apiuser`, {
                method: "POST",
                signal: AbortSignal.timeout(8_000),
                headers: {
                    "Content-Type": "application/json",
                    "X-Reference-Id": uuid,
                    "Ocp-Apim-Subscription-Key": this.subscriptionKey,
                },
                body: JSON.stringify({ providerCallbackHost: "localhost" })
            })

            if (!createRes.ok) {
                throw new Error(`Failed to create apiuser: status ${createRes.status}`)
            }

            console.log("[MTN MoMo] Generating Sandbox API Key...")
            const keyRes = await fetch(`${this.baseUrl}/v1_0/apiuser/${uuid}/apikey`, {
                method: "POST",
                signal: AbortSignal.timeout(8_000),
                headers: {
                    "Ocp-Apim-Subscription-Key": this.subscriptionKey,
                }
            })

            if (!keyRes.ok) {
                throw new Error(`Failed to generate apiKey: status ${keyRes.status}`)
            }

            const { apiKey } = (await keyRes.json()) as { apiKey: string };
            this.apiUser = uuid;
            this.apiKey = apiKey;
            console.log(`Provisioned Sandbox: USER = ${uuid}, KEY = ${apiKey}`)
            console.log("Please save these in your .env as MOMO_API_USER and MOMO_API_KEY")
        } catch (err) {
            console.error("[MTN MoMo] Provision Failed, falling back to mock mode:", err)
            this.isMock = true;
        }
    }

    // Fetches a fresh disbursement token and schedules the next refresh
    // 3 minutes before it expires.
    private async refreshDisbursementToken(): Promise<void> {
        await this.provisionSandbox()
        const auth = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString("base64");
        const res = await fetch(`${this.baseUrl}/disbursement/token/`, {
            method: "POST",
            signal: AbortSignal.timeout(8_000),
            headers: {
                Authorization: `Basic ${auth}`,
                "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            },
        })

        if (!res.ok) throw new Error(`Could not fetch disbursement OAuth token: status ${res.status}`)

        const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number }
        this.disbursementToken = access_token;

        // Schedule background refresh 3 minutes before actual expiry
        const refreshIn = ((expires_in ?? 3600) - 180) * 1_000
        const t = setTimeout(() => {
            this.refreshDisbursementToken().catch(err => {
                console.error("[MTN MoMo] Background disbursement token refresh failed:", err)
                // Retry in 60s rather than leaving the token stale
                const retry = setTimeout(() => {
                    this.refreshDisbursementToken().catch(e =>
                        console.error("[MTN MoMo] Retry disbursement token refresh failed:", e)
                    )
                }, 60_000)
                retry.unref()
            })
        }, refreshIn)
        t.unref()
    }

    private async getAccessToken(): Promise<string> {
        if (this.isMock) return "mock-token";
        if (!this.disbursementToken) {
            if (!this.disbursementRefreshing) {
                this.disbursementRefreshing = this.refreshDisbursementToken()
                    .finally(() => { this.disbursementRefreshing = null })
            }
            await this.disbursementRefreshing
        }
        return this.disbursementToken!
    }

    // Same pattern for the collections API
    private async refreshCollectionToken(): Promise<void> {
        await this.provisionSandbox()
        const auth = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString("base64");
        const res = await fetch(`${this.baseUrl}/collection/token/`, {
            method: "POST",
            signal: AbortSignal.timeout(8_000),
            headers: {
                Authorization: `Basic ${auth}`,
                "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            },
        })

        if (!res.ok) throw new Error(`Could not fetch collection OAuth token: status ${res.status}`)

        const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number }
        this.collectionToken = access_token;

        const refreshIn = ((expires_in ?? 3600) - 180) * 1_000
        const t = setTimeout(() => {
            this.refreshCollectionToken().catch(err => {
                console.error("[MTN MoMo] Background collection token refresh failed:", err)
                const retry = setTimeout(() => {
                    this.refreshCollectionToken().catch(e =>
                        console.error("[MTN MoMo] Retry collection token refresh failed:", e)
                    )
                }, 60_000)
                retry.unref()
            })
        }, refreshIn)
        t.unref()
    }

    private async getCollectionAccessToken(): Promise<string> {
        if (this.isMock) return "mock-token";
        if (!this.collectionToken) {
            if (!this.collectionRefreshing) {
                this.collectionRefreshing = this.refreshCollectionToken()
                    .finally(() => { this.collectionRefreshing = null })
            }
            await this.collectionRefreshing
        }
        return this.collectionToken!
    }

    /**
     * Pay a phone. `referenceId` should be the payment's own id (a UUID): MTN
     * treats X-Reference-Id as the idempotency key, so the same payment always
     * carries the same reference and a retry cannot pay twice. Returns the
     * reference to look the payment up with.
     *
     * Throws MoMoRejectedError when MTN refused (safe to refund) and
     * MoMoUnknownOutcomeError when we cannot tell (hold the payment).
     */
    async transfer(phone: string, amount: number, referenceId: string): Promise<string> {
        const momoRef = UUID_RE.test(referenceId) ? referenceId.toLowerCase() : crypto.randomUUID();
        const msisdn = normalizeMsisdn(phone);

        if (this.isMock) {
            console.log(`[MTN MoMo Mock] Simulating transfer of RWF ${amount} to ${msisdn} (Ref: ${momoRef})`);
            return momoRef;
        }

        const payload: MoMoTransferPayload = {
            amount: amount.toString(),
            currency: this.currency,
            externalId: referenceId,
            payee: {
                partyIdType: "MSISDN",
                partyId: msisdn,
            },
            payerMessage: "Corporate Expense",
            payeeNote: "Inventory Purchase",
        }

        const callbackUrl = mtnCallbackUrl(this.callbackBaseUrl, momoRef);

        for (let attempt = 0; attempt < 2; attempt++) {
            // A failure to get a token happens before anything is sent: a plain
            // error here means "nothing was paid".
            const token = await this.getAccessToken();

            let res: Response;
            try {
                res = await fetch(`${this.baseUrl}/disbursement/v1_0/transfer`, {
                    method: "POST",
                    signal: AbortSignal.timeout(8_000),
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "X-Reference-Id": momoRef,
                        "X-Target-Environment": this.targetEnv,
                        "Ocp-Apim-Subscription-Key": this.subscriptionKey,
                        "Content-Type": "application/json",
                        // Only when configured: MTN then calls this address once the transfer settles.
                        ...(callbackUrl ? { "X-Callback-Url": callbackUrl } : {}),
                    },
                    body: JSON.stringify(payload),
                });
            } catch (err: any) {
                const why = err?.name === "TimeoutError" || err?.name === "AbortError" ? "timed out" : (err?.message || "connection failed");
                throw new MoMoUnknownOutcomeError(`MTN did not answer the transfer request (${why}); it may or may not have been sent`);
            }

            // 202: accepted. 409: that reference was already received (a retry of
            // the same payment) — either way the payment exists; the status call
            // says how it ended.
            if (res.status === 202 || res.status === 409) return momoRef;

            // An expired token: nothing was processed. Get a fresh one and retry once.
            if (res.status === 401 && attempt === 0) {
                this.disbursementToken = null;
                continue;
            }

            const raw = await res.text().catch(() => "");
            const code = extractMoMoErrorCode(raw);

            if (res.status >= 500) {
                // MTN's error page lists several DEFINITE refusals that arrive as HTTP 500
                // with a named code (wrong target environment, restricted account, bad
                // currency, mismatched callback host). Nothing was created, so fail clearly
                // instead of holding the payment forever.
                if (code && DEFINITE_REJECTION_CODES.has(code)) {
                    throw new MoMoRejectedError(describeMoMoError(res.status, code), res.status);
                }
                // Any other 5xx: MTN broke while handling it — we cannot know whether it paid.
                throw new MoMoUnknownOutcomeError(`MTN answered ${res.status}${code ? ` ${code}` : ""} to the transfer request; it may or may not have been paid`);
            }

            throw new MoMoRejectedError(describeMoMoError(res.status, code), res.status);
        }
        throw new MoMoRejectedError(describeMoMoError(401, null), 401);
    }

    async getTransferStatus(momoRef: string): Promise<MoMoTransferStatusResponse> {
        if (this.isMock) {
            return { status: "SUCCESSFUL" }
        }

        const token = await this.getAccessToken()

        const res = await fetch(`${this.baseUrl}/disbursement/v1_0/transfer/${momoRef}`, {
            method: "GET",
            signal: AbortSignal.timeout(8_000),
            headers: {
                Authorization: `Bearer ${token}`,
                "X-Target-Environment": this.targetEnv,
                "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            },
        });

        if (res.status === 404) {
            return { status: "PENDING", notFound: true, reason: { code: "REFERENCE_NOT_FOUND", message: "MTN has no record of this reference" } }
        }
        if (res.status === 401) this.disbursementToken = null
        if (!res.ok) {
            throw new Error(`Failed to query transfer status: ${res.status}`);
        }
        const body = (await res.json()) as MoMoTransferStatusResponse;
        // Anything that is not an explicit final answer is "still in flight".
        const status = String(body?.status ?? "").toUpperCase();
        return { ...body, status: status === "SUCCESSFUL" || status === "FAILED" ? status : "PENDING" };
    }

    /**
     * Is this number an active MoMo account? true / false, or null when MTN
     * could not say (so callers can choose not to block on a lookup failure).
     * GET /disbursement/v1_0/accountholder/msisdn/{msisdn}/active
     */
    async isAccountActive(phone: string): Promise<boolean | null> {
        if (this.isMock) return true;
        try {
            const token = await this.getAccessToken();
            const res = await fetch(
                `${this.baseUrl}/disbursement/v1_0/accountholder/msisdn/${normalizeMsisdn(phone)}/active`,
                {
                    method: "GET",
                    signal: AbortSignal.timeout(8_000),
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "X-Target-Environment": this.targetEnv,
                        "Ocp-Apim-Subscription-Key": this.subscriptionKey,
                    },
                },
            );
            if (!res.ok) return null;
            const body = (await res.json()) as { result?: unknown };
            return typeof body?.result === "boolean" ? body.result : null;
        } catch {
            return null;
        }
    }

    /*
    // TODO: if this isn't used in any business logic even in any future features, remove it.
    async requestToPay(phone: string, amount: number, externalId: string): Promise<string> {
        const momoRef = crypto.randomUUID();

        if (this.isMock) {
            console.log(`[MTN MoMo Mock] Simulating Request to Pay (USSD push) of RWF ${amount} to ${phone} (Ref: ${momoRef})`);
            return momoRef;
        }

        try {
            const token = await this.getCollectionAccessToken();

            const payload = {
                amount: amount.toString(),
                currency: this.currency,
                externalId,
                payer: {
                    partyIdType: "MSISDN",
                    partyId: phone,
                },
                payerMessage: "Corporate Purchase",
                payeeNote: "Inventory Purchase",
            }

            console.log(`[MTN MoMo] Requesting payment from ${phone} via Collections...`)
            const res = await fetch(`${this.baseUrl}/collection/v1_0/requesttopay`, {
                method: "POST",
                signal: AbortSignal.timeout(8_000),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "X-Reference-Id": momoRef,
                    "X-Target-Environment": this.targetEnv,
                    "Ocp-Apim-Subscription-Key": this.subscriptionKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (res.status !== 202) {
                console.warn(`[MTN MoMo] Collections Request rejected with status ${res.status}. Falling back to mock simulation.`);
                return momoRef;
            }
            return momoRef
        } catch (err) {
            console.error("[MTN MoMo] Collections API error, falling back to mock:", err);
            return momoRef;
        }
    }*/

    async getCollectionStatus(momoRef: string): Promise<MoMoTransferStatusResponse> {
        if (this.isMock) {
            return { status: "SUCCESSFUL" }
        }

        try {
            const token = await this.getCollectionAccessToken()

            const res = await fetch(`${this.baseUrl}/collection/v1_0/requesttopay/${momoRef}`, {
                method: "GET",
                signal: AbortSignal.timeout(8_000),
                headers: {
                    Authorization: `Bearer ${token}`,
                    "X-Target-Environment": this.targetEnv,
                    "Ocp-Apim-Subscription-Key": this.subscriptionKey,
                },
            });

            if (!res.ok) {
                throw new Error(`Failed to query collection status: ${res.status}`);
            }
            return (await res.json()) as { status: "PENDING" | "SUCCESSFUL" | "FAILED"; reason?: { code: string; message: string } };
        } catch (err) {
            // Never invent a SUCCESSFUL: a status we could not read is unknown.
            console.error("[MTN MoMo] Error querying collection status:", err);
            throw err;
        }
    }

    private async attemptFetchBalance(): Promise<{ availableBalance: string; currency: string }> {
        const token = await this.getAccessToken();
        const res = await fetch(`${this.baseUrl}/disbursement/v1_0/account/balance`, {
            method: "GET",
            signal: AbortSignal.timeout(5_000),
            headers: {
                Authorization: `Bearer ${token}`,
                "X-Target-Environment": this.targetEnv,
                "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            },
        });
        // Read as text first: an error page (or a gateway's HTML) is not JSON, and MTN's
        // reason is the one thing an admin needs to see (e.g. 403 = this IP is not allowed).
        const raw = await res.text().catch(() => "");
        const code = extractMoMoErrorCode(raw);
        if (!res.ok) {
            throw Object.assign(new Error(describeMoMoError(res.status, code, "balance request")), { status: res.status, code });
        }
        try {
            return JSON.parse(raw) as { availableBalance: string; currency: string };
        } catch {
            throw Object.assign(new Error("MTN answered the balance request with something that is not JSON."), { status: 502 });
        }
    }

    async getAccountBalance(): Promise<{ availableBalance: string; currency: string }> {
        if (this.isMock) return { availableBalance: "1000000", currency: "RWF" };

        // console.time("getAccountBalance");
        // console.timeLog("getAccountBalance", "Starting to get account balance");

        try {
            try {
                const result = await this.attemptFetchBalance();
                // console.timeLog("getAccountBalance", "Fetched Balance in", this.targetEnv);
                // console.log("[MTN MoMo] Success querying account balance:", result);
                return result;
            } catch (err: any) {
                if (err.status !== 404) {
                    console.error("[MTN MoMo] Error querying account balance:", err.status, err.message);
                    throw err;
                }
                // console.timeLog("getAccountBalance", "404 — retrying");
                const result = await this.attemptFetchBalance();
                // console.timeLog("getAccountBalance", "Fetched Balance on retry in", this.targetEnv);
                // console.log("[MTN MoMo] Success querying account balance (retry):", result);
                return result;
            }
        } finally {
            // console.timeEnd("getAccountBalance");
        }
    }
}

export const momo = new MoMoClient()

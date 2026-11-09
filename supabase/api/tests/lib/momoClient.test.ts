import { describe, it, expect, vi, afterEach } from "vitest";
import { MoMoClient, MoMoRejectedError, MoMoUnknownOutcomeError, mtnCallbackUrl, normalizeMsisdn } from "../../src/lib/momo.js";

// Contract tests for the MTN MoMo Disbursement calls we make. fetch is mocked, so
// no network and no key. Paths and headers follow the portal screenshots in
// Crucial_Docs/MTN-MOMO-DISBURSEMENT-API-REFERENCE.md. Error-response bodies are
// NOT documented yet, so rejection tests only rely on the status code.

const BASE = "https://sandbox.momodeveloper.mtn.com";
const TX = "3f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

function client(over: Record<string, unknown> = {}) {
  return new MoMoClient({
    subscriptionKey: "sub-key",
    apiUser: "user",
    apiKey: "key",
    targetEnv: "sandbox",
    baseUrl: BASE,
    currency: "EUR",
    mode: "",
    callbackBaseUrl: "",
    warm: false,
    ...over,
  });
}

type Reply = { status: number; body?: unknown } | Error;

/** Token calls always succeed; everything else answers from `next` in order. */
function mockFetch(next: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let tokens = 0;
  const spy = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/disbursement/token/")) {
      tokens++;
      return { ok: true, status: 200, json: async () => ({ access_token: `tok-${tokens}`, expires_in: 3600 }), text: async () => "" };
    }
    calls.push({ url, init });
    const r = next.shift();
    if (!r) throw new Error("unexpected extra fetch: " + url);
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? "")),
    };
  });
  vi.stubGlobal("fetch", spy);
  return { calls, tokens: () => tokens };
}

afterEach(() => vi.unstubAllGlobals());

describe("normalizeMsisdn", () => {
  it("turns local and formatted Rwandan numbers into digits with the country code", () => {
    expect(normalizeMsisdn("0788123456", "250")).toBe("250788123456");
    expect(normalizeMsisdn("+250 788 123 456", "250")).toBe("250788123456");
    expect(normalizeMsisdn("00250788123456", "250")).toBe("250788123456");
    expect(normalizeMsisdn("(078) 812-3456", "250")).toBe("250788123456");
  });
  it("leaves numbers that already have a country code, such as sandbox test numbers", () => {
    expect(normalizeMsisdn("46733123450", "250")).toBe("46733123450");
    expect(normalizeMsisdn("250788123456", "250")).toBe("250788123456");
  });
});

describe("MoMo transfer — the request", () => {
  it("POSTs to /disbursement/v1_0/transfer with the documented headers and body", async () => {
    const { calls } = mockFetch([{ status: 202 }]);
    const ref = await client().transfer("0788123456", 1500, TX);

    expect(ref).toBe(TX);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(`${BASE}/disbursement/v1_0/transfer`);
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok-1");
    expect(h["X-Reference-Id"]).toBe(TX);
    expect(h["X-Target-Environment"]).toBe("sandbox");
    expect(h["Ocp-Apim-Subscription-Key"]).toBe("sub-key");
    expect(h["X-Callback-Url"]).toBeUndefined(); // no callback until its format is documented
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      amount: "1500", // a string, as the schema says
      currency: "EUR",
      externalId: TX,
      payee: { partyIdType: "MSISDN", partyId: "250788123456" },
    });
  });

  it("uses the same reference every time for the same payment (idempotent)", async () => {
    const { calls } = mockFetch([{ status: 202 }, { status: 409 }]);
    const c = client();
    const r1 = await c.transfer("0788123456", 500, TX);
    const r2 = await c.transfer("0788123456", 500, TX);
    expect(r1).toBe(r2);
    expect((calls[0].init.headers as any)["X-Reference-Id"]).toBe((calls[1].init.headers as any)["X-Reference-Id"]);
  });

  it("makes up a valid UUID when it is not given one", async () => {
    const { calls } = mockFetch([{ status: 202 }]);
    const ref = await client().transfer("0788123456", 500, "not-a-uuid");
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);
    expect((calls[0].init.headers as any)["X-Reference-Id"]).toBe(ref);
  });

  it("mock mode (no subscription key) makes no network call", async () => {
    const { calls } = mockFetch([]);
    const ref = await new MoMoClient({ subscriptionKey: "", warm: false }).transfer("0788123456", 500, TX);
    expect(ref).toBe(TX);
    expect(calls).toHaveLength(0);
  });
});

describe("MoMo transfer — what each answer means for the money", () => {
  it("202 Accepted and 409 (reference already received) both mean the payment exists", async () => {
    mockFetch([{ status: 202 }]);
    await expect(client().transfer("0788123456", 500, TX)).resolves.toBe(TX);
    mockFetch([{ status: 409 }]);
    await expect(client().transfer("0788123456", 500, TX)).resolves.toBe(TX);
  });

  for (const status of [400, 403, 404, 429]) {
    it(`${status} is a definite refusal (safe to refund)`, async () => {
      mockFetch([{ status, body: { code: "SOME_CODE", message: "no" } }]);
      const err = await client().transfer("0788123456", 500, TX).catch((e) => e);
      expect(err).toBeInstanceOf(MoMoRejectedError);
      expect((err as MoMoRejectedError).httpStatus).toBe(status);
      expect((err as any).unknownOutcome).toBeUndefined();
    });
  }

  for (const status of [500, 502, 503]) {
    it(`${status} is an UNKNOWN outcome (hold the payment, never refund)`, async () => {
      mockFetch([{ status }]);
      const err = await client().transfer("0788123456", 500, TX).catch((e) => e);
      expect(err).toBeInstanceOf(MoMoUnknownOutcomeError);
      expect((err as any).unknownOutcome).toBe(true);
    });
  }

  it("a timeout is an UNKNOWN outcome", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    mockFetch([timeout]);
    const err = await client().transfer("0788123456", 500, TX).catch((e) => e);
    expect(err).toBeInstanceOf(MoMoUnknownOutcomeError);
    expect(err.message).toMatch(/timed out/);
  });

  it("a dropped connection is an UNKNOWN outcome", async () => {
    mockFetch([new TypeError("fetch failed")]);
    await expect(client().transfer("0788123456", 500, TX)).rejects.toBeInstanceOf(MoMoUnknownOutcomeError);
  });

  it("an expired token (401) gets one fresh token and a retry; the retry is the same payment", async () => {
    const { calls, tokens } = mockFetch([{ status: 401 }, { status: 202 }]);
    await expect(client().transfer("0788123456", 500, TX)).resolves.toBe(TX);
    expect(tokens()).toBe(2);
    expect((calls[0].init.headers as any).Authorization).toBe("Bearer tok-1");
    expect((calls[1].init.headers as any).Authorization).toBe("Bearer tok-2");
    expect((calls[1].init.headers as any)["X-Reference-Id"]).toBe(TX);
  });

  it("a 401 that persists is a refusal, not an endless loop", async () => {
    mockFetch([{ status: 401 }, { status: 401 }]);
    await expect(client().transfer("0788123456", 500, TX)).rejects.toBeInstanceOf(MoMoRejectedError);
  });
});

describe("MoMo transfer status", () => {
  it("GETs /disbursement/v1_0/transfer/{reference} and passes SUCCESSFUL / FAILED / PENDING through", async () => {
    const { calls } = mockFetch([
      { status: 200, body: { status: "SUCCESSFUL", financialTransactionId: "123" } },
      { status: 200, body: { status: "FAILED", reason: { code: "NOT_ENOUGH_FUNDS", message: "x" } } },
      { status: 200, body: { status: "PENDING" } },
    ]);
    const c = client();
    expect((await c.getTransferStatus(TX)).status).toBe("SUCCESSFUL");
    const failed = await c.getTransferStatus(TX);
    expect(failed.status).toBe("FAILED");
    expect(failed.reason?.code).toBe("NOT_ENOUGH_FUNDS");
    expect((await c.getTransferStatus(TX)).status).toBe("PENDING");
    expect(calls[0].url).toBe(`${BASE}/disbursement/v1_0/transfer/${TX}`);
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as any)["X-Target-Environment"]).toBe("sandbox");
  });

  it("anything that is not an explicit final answer is still PENDING", async () => {
    mockFetch([{ status: 200, body: { status: "ONGOING" } }, { status: 200, body: {} }]);
    const c = client();
    expect((await c.getTransferStatus(TX)).status).toBe("PENDING");
    expect((await c.getTransferStatus(TX)).status).toBe("PENDING");
  });

  it("404 (no record) is reported as PENDING + notFound — never as FAILED", async () => {
    mockFetch([{ status: 404 }]);
    const s = await client().getTransferStatus(TX);
    expect(s.status).toBe("PENDING");
    expect(s.notFound).toBe(true);
  });

  it("a server error throws, so callers leave the payment alone", async () => {
    mockFetch([{ status: 500 }]);
    await expect(client().getTransferStatus(TX)).rejects.toThrow(/500/);
  });
});

describe("MoMo account check", () => {
  it("GETs /accountholder/msisdn/{msisdn}/active with the number normalised", async () => {
    const { calls } = mockFetch([{ status: 200, body: { result: true } }]);
    expect(await client().isAccountActive("0788123456")).toBe(true);
    expect(calls[0].url).toBe(`${BASE}/disbursement/v1_0/accountholder/msisdn/250788123456/active`);
  });
  it("false means not active; anything unreadable is null (unknown), never a guess", async () => {
    mockFetch([{ status: 200, body: { result: false } }, { status: 500 }, { status: 200, body: {} }, new TypeError("down")]);
    const c = client();
    expect(await c.isAccountActive("0788123456")).toBe(false);
    expect(await c.isAccountActive("0788123456")).toBeNull();
    expect(await c.isAccountActive("0788123456")).toBeNull();
    expect(await c.isAccountActive("0788123456")).toBeNull();
  });
});

describe("MTN callback address", () => {
  it("is the https origin + /webhooks/mtn/<payment reference>", () => {
    expect(mtnCallbackUrl("https://api.example.com", TX)).toBe(`https://api.example.com/webhooks/mtn/${TX}`);
    expect(mtnCallbackUrl("https://api.example.com/", TX)).toBe(`https://api.example.com/webhooks/mtn/${TX}`);
  });
  it("is none when not configured, not https, or carries a path (MTN only takes an https host)", () => {
    expect(mtnCallbackUrl("", TX)).toBeNull();
    expect(mtnCallbackUrl("http://api.example.com", TX)).toBeNull();
    expect(mtnCallbackUrl("https://api.example.com/v1", TX)).toBeNull();
    expect(mtnCallbackUrl("api.example.com", TX)).toBeNull();
  });

  it("the transfer asks for the callback only when it is configured", async () => {
    const withCb = mockFetch([{ status: 202 }]);
    await client({ callbackBaseUrl: "https://api.example.com" }).transfer("0788123456", 500, TX);
    expect((withCb.calls[0].init.headers as any)["X-Callback-Url"]).toBe(`https://api.example.com/webhooks/mtn/${TX}`);

    const without = mockFetch([{ status: 202 }]);
    await client({ callbackBaseUrl: "" }).transfer("0788123456", 500, TX);
    expect((without.calls[0].init.headers as any)["X-Callback-Url"]).toBeUndefined();

    const bad = mockFetch([{ status: 202 }]);
    await client({ callbackBaseUrl: "http://insecure.example.com" }).transfer("0788123456", 500, TX);
    expect((bad.calls[0].init.headers as any)["X-Callback-Url"]).toBeUndefined();
  });
});

describe("MTN's documented error behaviour", () => {
  it("500 with a named refusal code is a DEFINITE rejection (nothing was paid), with the fix in words", async () => {
    for (const [code, hint] of [
      ["NOT_ALLOWED_TARGET_ENVIRONMENT", /mtnrwanda/],
      ["INVALID_CALLBACK_URL_HOST", /registered/],
      ["INVALID_CURRENCY", /currency/i],
      ["NOT_ALLOWED", /restricted/],
    ] as const) {
      mockFetch([{ status: 500, body: { code, message: "x" } }]);
      const err = await client().transfer("0788123456", 500, TX).catch((e) => e);
      expect(err, code).toBeInstanceOf(MoMoRejectedError);
      expect((err as any).unknownOutcome).toBeUndefined();
      expect(err.message).toMatch(hint);
    }
  });

  it("any other 500 stays an UNKNOWN outcome (it might have paid), including SERVICE_UNAVAILABLE", async () => {
    mockFetch([{ status: 500, body: { code: "INTERNAL_ERROR" } }]);
    await expect(client().transfer("0788123456", 500, TX)).rejects.toBeInstanceOf(MoMoUnknownOutcomeError);
    mockFetch([{ status: 503, body: { code: "SERVICE_UNAVAILABLE" } }]);
    await expect(client().transfer("0788123456", 500, TX)).rejects.toBeInstanceOf(MoMoUnknownOutcomeError);
  });

  it("403 (IP not allowed) is a rejection that says to share the server's IP", async () => {
    mockFetch([{ status: 403 }]);
    const err = await client().transfer("0788123456", 500, TX).catch((e) => e);
    expect(err).toBeInstanceOf(MoMoRejectedError);
    expect(err.message).toMatch(/IP address/);
  });

  it("the reference must be a UUID v4: a v1 id is replaced, a v4 id is kept", async () => {
    const v1 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const a = mockFetch([{ status: 202 }]);
    const ref = await client().transfer("0788123456", 500, v1);
    expect(ref).not.toBe(v1);
    expect(ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((a.calls[0].init.headers as any)["X-Reference-Id"]).toBe(ref);
    mockFetch([{ status: 202 }]);
    expect(await client().transfer("0788123456", 500, TX)).toBe(TX);
  });

  it("the notes we send obey MTN's limits: at most 160 characters and no apostrophes", async () => {
    const { calls } = mockFetch([{ status: 202 }]);
    await client().transfer("0788123456", 500, TX);
    const body = JSON.parse(calls[0].init.body as string);
    for (const note of [body.payerMessage, body.payeeNote]) {
      expect(note.length).toBeLessThanOrEqual(160);
      expect(note).not.toMatch(/'/);
    }
  });
});

describe("balance check reports MTN's reason", () => {
  it("403 says the server's IP is not allowed", async () => {
    mockFetch([{ status: 403 }]);
    const err = await client().getAccountBalance().catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/balance request rejected \(403\).*IP address/);
  });
  it("a wrong target environment (a 500 with a code) is explained", async () => {
    mockFetch([{ status: 500, body: { code: "NOT_ALLOWED_TARGET_ENVIRONMENT" } }]);
    const err = await client().getAccountBalance().catch((e) => e);
    expect(err.message).toMatch(/mtnrwanda/);
  });
  it("a non-JSON answer does not crash with a parse error", async () => {
    mockFetch([{ status: 200, body: "<html>gateway</html>" }]);
    const err = await client().getAccountBalance().catch((e) => e);
    expect(err.message).toMatch(/not JSON/);
  });
  it("returns the balance when all is well", async () => {
    mockFetch([{ status: 200, body: { availableBalance: "125000", currency: "RWF" } }]);
    expect(await client().getAccountBalance()).toEqual({ availableBalance: "125000", currency: "RWF" });
  });
});

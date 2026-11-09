import { describe, it, expect, vi, afterEach } from "vitest";
import {
  apiRoot,
  isSuccessBody,
  initiateBulkDisbursement,
  checkTransfer,
  getWalletBalance,
  UrubutoUnknownOutcomeError,
} from "../../src/lib/urubutopay/client.js";
import { fetchTransferStatus } from "../../src/lib/urubutopay/status.js";
import { performTransfer } from "../../src/lib/urubutopay/transfer.js";
import { mapUrubutoStatus } from "../../src/lib/urubutopay/statusMap.js";

// Contract tests: mocked fetch returns the exact response shapes from the live
// UrubutoPay Swagger (https://developers.urubutopay.rw/reference/) and the
// BulkDisbursement PDF. No network, no key.

const cfg = { baseUrl: "https://staging.urubutopay.rw", apiKey: "upg:test_key" };

function mockFetch(httpStatus: number, body: unknown) {
  const spy = vi.fn(async () => ({
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

const initiateReq = {
  source_of_funds: "WALLET-1",
  source_payment_channel: "MERCHANT_WALLET" as const,
  destination_payment_channel: "MOMO" as const,
  external_transaction_ref_number: "TRX-1",
  beneficiary_to_be_charged: "NO" as const,
  wallet_account_id: "WA1",
  beneficiaries: [],
};

describe("apiRoot", () => {
  it("appends /api to a bare host and is idempotent", () => {
    expect(apiRoot("https://staging.urubutopay.rw")).toBe("https://staging.urubutopay.rw/api");
    expect(apiRoot("https://staging.urubutopay.rw/")).toBe("https://staging.urubutopay.rw/api");
    expect(apiRoot("https://staging.urubutopay.rw/api")).toBe("https://staging.urubutopay.rw/api");
  });
});

describe("isSuccessBody", () => {
  it("accepts success:true, status 200 number, and status '200' string", () => {
    expect(isSuccessBody({ success: true })).toBe(true);
    expect(isSuccessBody({ status: 200 })).toBe(true);
    expect(isSuccessBody({ status: "200" })).toBe(true);
  });
  it("rejects success:false, 4xx statuses, and empty bodies", () => {
    expect(isSuccessBody({ success: false, status: 200 })).toBe(false);
    expect(isSuccessBody({ status: 401 })).toBe(false);
    expect(isSuccessBody({})).toBe(false);
    expect(isSuccessBody(null)).toBe(false);
  });
});

describe("initiateBulkDisbursement", () => {
  const data = { internal_transaction_ref_number: "UPG24072700001", transaction_status: "PENDING" };

  it("hits /api/v2/bulk-disbursement/initiate with the Authorization header", async () => {
    const spy = mockFetch(200, { success: true, message: "ok", data });
    await initiateBulkDisbursement(cfg, initiateReq);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://staging.urubutopay.rw/api/v2/bulk-disbursement/initiate");
    expect((init.headers as Record<string, string>).Authorization).toBe("upg:test_key");
  });

  it("can send the key as x-api-key instead", async () => {
    const spy = mockFetch(200, { success: true, data });
    await initiateBulkDisbursement({ ...cfg, authHeader: "x-api-key" }, initiateReq);
    const headers = (spy.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("upg:test_key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("accepts the PDF envelope (status as string '200')", async () => {
    mockFetch(200, { status: "200", message: "bulk initiated successful", data });
    await expect(initiateBulkDisbursement(cfg, initiateReq)).resolves.toBeTruthy();
  });

  it("rejects a 401 body", async () => {
    mockFetch(401, { status: 401, message: "unauthorized access" });
    await expect(initiateBulkDisbursement(cfg, initiateReq)).rejects.toThrow(/rejected.*401.*unauthorized/);
  });

  it("rejects an HTML page (wrong path / IP block) instead of crashing on JSON.parse", async () => {
    mockFetch(404, "<!DOCTYPE html><html></html>");
    await expect(initiateBulkDisbursement(cfg, initiateReq)).rejects.toThrow(/HTTP 404/);
  });

  it("rejects a success response with no internal_transaction_ref_number", async () => {
    mockFetch(200, { success: true, data: {} });
    await expect(initiateBulkDisbursement(cfg, initiateReq)).rejects.toThrow(/internal_transaction_ref_number/);
  });
});

describe("check-transfer", () => {
  const data = { transaction_status: "SUCCESSFUL", beneficiary_code: "EMP-1001" };

  it.each([
    ["success:true envelope (Swagger prose)", { success: true, message: "ok", data }],
    ["status:200 envelope (Swagger schema)", { timestamp: "2026-09-21 16:52:10", status: 200, data }],
  ])("reads %s as SUCCESSFUL", async (_n, body) => {
    mockFetch(200, body);
    const r = await fetchTransferStatus({ ...cfg, walletAccountId: "WA1" }, "UPG1:EMP-1001");
    expect(r.status).toBe("SUCCESSFUL");
  });

  it("reads SUCCESS (the other spelling in the spec) as SUCCESSFUL", () => {
    expect(mapUrubutoStatus("SUCCESS")).toBe("SUCCESSFUL");
  });

  it("returns PENDING for INITIATED and for 'Transfer not found'", async () => {
    mockFetch(200, { success: true, data: { transaction_status: "INITIATED" } });
    expect((await fetchTransferStatus({ ...cfg, walletAccountId: "" }, "UPG1:EMP")).status).toBe("PENDING");
    mockFetch(200, { success: false, message: "Transfer not found" });
    expect((await fetchTransferStatus({ ...cfg, walletAccountId: "" }, "UPG1:EMP")).status).toBe("PENDING");
  });

  it("throws on a non-JSON body", async () => {
    mockFetch(502, "<html>bad gateway</html>");
    await expect(checkTransfer(cfg, "UPG1", "EMP")).rejects.toThrow(/HTTP 502/);
  });
});

describe("wallet balance", () => {
  const ok = { status: true, code: "SUCCESS", data: { balance: 2500000, currency: "RWF", organization: { name: "ABC" } } };

  it("omits wallet_account_id when none is configured, includes it when set", async () => {
    const spy = mockFetch(200, ok);
    await getWalletBalance(cfg, "");
    expect((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe("{}");
    await getWalletBalance(cfg, "wacc123");
    expect((spy.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe('{"wallet_account_id":"wacc123"}');
  });

  it("accepts the boolean `status: true` envelope", async () => {
    mockFetch(200, ok);
    expect((await getWalletBalance(cfg, "")).data.balance).toBe(2500000);
  });

  it("throws on 403 forbidden", async () => {
    mockFetch(403, { status: 403, message: "forbidden access" });
    await expect(getWalletBalance(cfg, "")).rejects.toThrow(/403.*forbidden/);
  });
});

describe("unknown outcome vs definite rejection (decides refund vs hold)", () => {
  const data = { internal_transaction_ref_number: "UPG1" };

  it("a network failure / timeout is an UNKNOWN outcome", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }));
    await expect(initiateBulkDisbursement(cfg, initiateReq)).rejects.toBeInstanceOf(UrubutoUnknownOutcomeError);
  });

  it("a 5xx or non-JSON reply is an UNKNOWN outcome", async () => {
    mockFetch(500, { status: 500, message: "server error" });
    await expect(initiateBulkDisbursement(cfg, initiateReq)).rejects.toBeInstanceOf(UrubutoUnknownOutcomeError);
    mockFetch(502, "<html>bad gateway</html>");
    await expect(initiateBulkDisbursement(cfg, initiateReq)).rejects.toBeInstanceOf(UrubutoUnknownOutcomeError);
  });

  it("success without a reference is an UNKNOWN outcome", async () => {
    mockFetch(200, { success: true, data: {} });
    await expect(initiateBulkDisbursement(cfg, initiateReq)).rejects.toBeInstanceOf(UrubutoUnknownOutcomeError);
  });

  it("a 4xx rejection or success:false is a DEFINITE failure (plain Error)", async () => {
    mockFetch(400, { status: 400, message: "Validation Failed" });
    const err = await initiateBulkDisbursement(cfg, initiateReq).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UrubutoUnknownOutcomeError);
    mockFetch(200, { success: false, message: "Insufficient balance", data });
    const err2 = await initiateBulkDisbursement(cfg, initiateReq).catch((e) => e);
    expect(err2).not.toBeInstanceOf(UrubutoUnknownOutcomeError);
  });
});

describe("performTransfer idempotency", () => {
  const deps = { ...cfg, walletAccountId: "WA1" };

  it("derives external ref and beneficiary_code from the transaction id, identically on every call", async () => {
    const spy = mockFetch(200, { success: true, data: { internal_transaction_ref_number: "UPG9" } });
    const r1 = await performTransfer(deps, { phone: "0788123456" }, 500, "tx-abc");
    const r2 = await performTransfer(deps, { phone: "0788123456" }, 500, "tx-abc");
    const bodies = spy.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0].external_transaction_ref_number).toBe("verlet-tx-abc");
    expect(bodies[1].external_transaction_ref_number).toBe("verlet-tx-abc");
    expect(bodies[0].beneficiaries[0].beneficiary_code).toBe("tx-abc");
    expect(r1).toBe("UPG9:tx-abc");
    expect(r2).toBe(r1);
  });
});

describe("performTransfer beneficiary name (phone payments)", () => {
  const deps = { ...cfg, walletAccountId: "WA1" };
  const sentName = async (input: Parameters<typeof performTransfer>[1]) => {
    const spy = mockFetch(200, { success: true, data: { internal_transaction_ref_number: "UPG1" } });
    await performTransfer(deps, input, 500, "tx-n");
    const body = JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    return body.beneficiaries[0].beneficiary_names as string;
  };

  it("sends the recipient's name when the request has one (trimmed)", async () => {
    expect(await sentName({ phone: "0788123456", recipientName: "  Amina Uwase " })).toBe("Amina Uwase");
  });
  it("keeps the generic label for payments with no name (older ones, older app builds)", async () => {
    expect(await sentName({ phone: "0788123456" })).toBe("Employee Reimbursement");
    expect(await sentName({ phone: "0788123456", recipientName: "   " })).toBe("Employee Reimbursement");
    expect(await sentName({ phone: "0788123456", recipientName: null })).toBe("Employee Reimbursement");
  });
  it("a bank-account payment still uses the account name, not the recipient name", async () => {
    expect(
      await sentName({ recipientName: "Ignored", metadata: { bankAccountNumber: "100081234567", bankAccountName: "ACME Ltd" } }),
    ).toBe("ACME Ltd");
  });
});

import { describe, it, expect } from "vitest";
import { bk } from "../../src/lib/bk.js";

// bk runs in MOCK mode here (no real URUBUTOPAY_API_KEY set, or
// URUBUTOPAY_MODE=demo in .env.test) — deterministic, touches no network.
describe("bk (mock mode)", () => {
  it("transfer() with a phone number (Pattern 2 — employee reimbursement) returns a reference string", async () => {
    const ref = await bk.transfer({ phone: "0788123456" }, 1000, "test-tx-id");
    expect(typeof ref).toBe("string");
    expect(ref.length).toBeGreaterThan(0);
  });

  it("transfer() with bank account details (Pattern 1 — vendor payment) returns a reference string", async () => {
    const ref = await bk.transfer(
      { metadata: { bankAccountNumber: "100081234567", bankAccountName: "Test Vendor Ltd" } },
      1000,
      "test-tx-id",
    );
    expect(typeof ref).toBe("string");
    expect(ref.length).toBeGreaterThan(0);
  });

  it("getTransferStatus() returns SUCCESSFUL", async () => {
    const result = await bk.getTransferStatus("MOCK:any-ref");
    expect(result.status).toBe("SUCCESSFUL");
  });

  it("getAccountBalance() returns a placeholder wallet balance", async () => {
    const balance = await bk.getAccountBalance();
    expect(balance).toEqual({ availableBalance: "1000000", currency: "RWF" });
  });
});

import { describe, it, expect } from "vitest";
import { assertUrubutopayConfigured } from "../../src/env.js";

describe("assertUrubutopayConfigured (BK/UrubutoPay fail-closed guard)", () => {
  it("throws in production when URUBUTOPAY_API_KEY is missing", () => {
    expect(() =>
      assertUrubutopayConfigured(true, "", "https://staging.urubutopay.rw", "wallet-1"),
    ).toThrow(/UrubutoPay is not fully configured/);
  });

  it("throws in production when URUBUTOPAY_BASE_URL is missing", () => {
    expect(() =>
      assertUrubutopayConfigured(true, "key", "", "wallet-1"),
    ).toThrow(/UrubutoPay is not fully configured/);
  });

  it("throws in production when URUBUTOPAY_WALLET_ACCOUNT_ID is missing", () => {
    expect(() =>
      assertUrubutopayConfigured(true, "key", "https://staging.urubutopay.rw", ""),
    ).toThrow(/UrubutoPay is not fully configured/);
  });

  it("reports every missing var name", () => {
    expect(() =>
      assertUrubutopayConfigured(true, "", "", ""),
    ).toThrow(/URUBUTOPAY_API_KEY, URUBUTOPAY_BASE_URL, URUBUTOPAY_WALLET_ACCOUNT_ID/);
  });

  it("does NOT throw in production when all vars are present", () => {
    expect(() =>
      assertUrubutopayConfigured(true, "key", "https://staging.urubutopay.rw", "wallet-1"),
    ).not.toThrow();
  });

  it("does NOT throw in dev when vars are missing (mock mode allowed)", () => {
    expect(() =>
      assertUrubutopayConfigured(false, "", "", ""),
    ).not.toThrow();
  });
});

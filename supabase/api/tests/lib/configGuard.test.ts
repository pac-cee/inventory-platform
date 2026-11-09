import { describe, it, expect } from "vitest";
import { assertMoMoConfigured } from "../../src/env.js";

describe("assertMoMoConfigured (E6 fail-closed guard)", () => {
  // Phase B #4: all four MoMo vars must be present in prod, not just the key.
  it("throws in production when MOMO_SUBSCRIPTION_KEY is missing", () => {
    expect(() =>
      assertMoMoConfigured(true, "", "u", "k", "sandbox"),
    ).toThrow(/MTN MoMo is not fully configured/);
  });

  it("throws in production when MOMO_API_USER is missing", () => {
    expect(() =>
      assertMoMoConfigured(true, "key", "", "k", "sandbox"),
    ).toThrow(/MTN MoMo is not fully configured/);
  });

  it("throws in production when MOMO_API_KEY is missing", () => {
    expect(() =>
      assertMoMoConfigured(true, "key", "u", "", "sandbox"),
    ).toThrow(/MTN MoMo is not fully configured/);
  });

  it("throws in production when MOMO_TARGET_ENV is missing", () => {
    expect(() =>
      assertMoMoConfigured(true, "key", "u", "k", ""),
    ).toThrow(/MTN MoMo is not fully configured/);
  });

  it("reports every missing var name", () => {
    expect(() =>
      assertMoMoConfigured(true, "", "", "", ""),
    ).toThrow(/MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY, MOMO_TARGET_ENV/);
  });

  it("does NOT throw in production when all vars are present", () => {
    expect(() =>
      assertMoMoConfigured(true, "key", "u", "k", "sandbox"),
    ).not.toThrow();
  });

  it("does NOT throw in dev when vars are missing (mock mode allowed)", () => {
    expect(() =>
      assertMoMoConfigured(false, "", "", "", ""),
    ).not.toThrow();
  });
});

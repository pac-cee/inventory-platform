import { describe, it, expect } from "vitest";
import {
  DEFINITE_REJECTION_CODES,
  describeMoMoError,
  describeMoMoReason,
  extractMoMoErrorCode,
} from "../../src/lib/momoErrors.js";

// From MTN's "Common Error Codes" page (Crucial_Docs/MTN).
describe("extractMoMoErrorCode", () => {
  it("finds a named code whatever the JSON looks like", () => {
    expect(extractMoMoErrorCode('{"code":"NOT_ALLOWED_TARGET_ENVIRONMENT","message":"x"}')).toBe("NOT_ALLOWED_TARGET_ENVIRONMENT");
    expect(extractMoMoErrorCode('{"error":{"code":"INVALID_CURRENCY"}}')).toBe("INVALID_CURRENCY");
    expect(extractMoMoErrorCode("Internal error: INVALID_CALLBACK_URL_HOST")).toBe("INVALID_CALLBACK_URL_HOST");
  });
  it("does not mistake NOT_ALLOWED_TARGET_ENVIRONMENT for the shorter NOT_ALLOWED", () => {
    expect(extractMoMoErrorCode('{"code":"NOT_ALLOWED_TARGET_ENVIRONMENT"}')).toBe("NOT_ALLOWED_TARGET_ENVIRONMENT");
    expect(extractMoMoErrorCode('{"code":"NOT_ALLOWED"}')).toBe("NOT_ALLOWED");
  });
  it("reads an unlisted code from a plain `code` field, and gives null for nothing usable", () => {
    expect(extractMoMoErrorCode('{"code":"SOMETHING_NEW"}')).toBe("SOMETHING_NEW");
    expect(extractMoMoErrorCode("")).toBeNull();
    expect(extractMoMoErrorCode(null)).toBeNull();
    expect(extractMoMoErrorCode("<html>Bad gateway</html>")).toBeNull();
  });
});

describe("which 500s are definite refusals", () => {
  it("exactly the four MTN documents as refused-before-processing", () => {
    expect([...DEFINITE_REJECTION_CODES].sort()).toEqual(
      ["INVALID_CALLBACK_URL_HOST", "INVALID_CURRENCY", "NOT_ALLOWED", "NOT_ALLOWED_TARGET_ENVIRONMENT"].sort(),
    );
  });
  it("a generic server error or 'service unavailable' is NOT among them (it might have paid)", () => {
    expect(DEFINITE_REJECTION_CODES.has("SERVICE_UNAVAILABLE")).toBe(false);
    expect(DEFINITE_REJECTION_CODES.has("INTERNAL_PROCESSING_ERROR")).toBe(false);
  });
});

describe("describeMoMoError", () => {
  it("says what to do, in plain words", () => {
    expect(describeMoMoError(500, "NOT_ALLOWED_TARGET_ENVIRONMENT")).toMatch(/mtnrwanda/);
    expect(describeMoMoError(500, "INVALID_CURRENCY")).toMatch(/EUR.*RWF/);
    expect(describeMoMoError(500, "INVALID_CALLBACK_URL_HOST")).toMatch(/not an IP/);
    expect(describeMoMoError(403, null)).toMatch(/IP address/);
    expect(describeMoMoError(401, null)).toMatch(/subscription key/);
    expect(describeMoMoError(400, null)).toMatch(/apostrophe/);
  });
  it("always names the status and the code, and has a fallback", () => {
    expect(describeMoMoError(500, "NOT_ALLOWED")).toMatch(/^MoMo transfer rejected \(500 NOT_ALLOWED\)/);
    expect(describeMoMoError(418, null)).toMatch(/\(418\)/);
  });
});

describe("describeMoMoReason (the reason MTN gives on a FAILED payment)", () => {
  it("INTERNAL_PROCESSING_ERROR is mostly insufficient funds", () => {
    expect(describeMoMoReason("INTERNAL_PROCESSING_ERROR")).toMatch(/insufficient funds/i);
  });
  it("PAYEE_NOT_FOUND points at the phone number", () => {
    expect(describeMoMoReason("PAYEE_NOT_FOUND")).toMatch(/country code/);
  });
  it("COULD_NOT_PERFORM_TRANSACTION is the 5-minute timeout", () => {
    expect(describeMoMoReason("COULD_NOT_PERFORM_TRANSACTION")).toMatch(/5 minutes/);
  });
  it("an unknown or missing code gives null (the raw code is shown instead)", () => {
    expect(describeMoMoReason("SOMETHING_NEW")).toBeNull();
    expect(describeMoMoReason(undefined)).toBeNull();
  });
});

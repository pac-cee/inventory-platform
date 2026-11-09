import { describe, it, expect } from "vitest";
import { newQrToken, normalizeQrToken, QR_TOKEN_LENGTH } from "../../src/lib/qrToken.js";

describe("QR tokens", () => {
  it("are the right length and use only unambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const t = newQrToken();
      expect(t).toHaveLength(QR_TOKEN_LENGTH);
      expect(t).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/); // no I, L, O, U
    }
  });

  it("do not repeat across a large sample", () => {
    const seen = new Set(Array.from({ length: 5000 }, () => newQrToken()));
    expect(seen.size).toBe(5000);
  });

  it("normalise what a scanner or a person might hand over", () => {
    const t = newQrToken();
    expect(normalizeQrToken(t)).toBe(t);
    expect(normalizeQrToken(`  ${t.toLowerCase()} `)).toBe(t);
  });

  it("reject anything that is not a code", () => {
    expect(normalizeQrToken("")).toBeNull();
    expect(normalizeQrToken("short")).toBeNull();
    expect(normalizeQrToken("ABCDEFGHIJ")).toBeNull(); // contains I, which is never issued
    expect(normalizeQrToken("0123456789A")).toBeNull(); // too long
    expect(normalizeQrToken("../etc/pa")).toBeNull();
  });
});

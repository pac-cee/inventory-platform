import { describe, it, expect } from "vitest";
import { boxQrData, parseBoxQr } from "./box-qr";

describe("box QR", () => {
  it("round-trips a code", () => {
    expect(parseBoxQr(boxQrData("ABCDEFGH23"))).toBe("ABCDEFGH23");
  });
  it("is forgiving about case and stray spaces", () => {
    expect(parseBoxQr("  inventory:box:abcdefgh23 ")).toBe("ABCDEFGH23");
  });
  it("rejects anything that is not a box code", () => {
    expect(parseBoxQr("inventory:item:6f1c2d3e-0000-4000-8000-000000000000")).toBeNull();
    expect(parseBoxQr("inventory:box:")).toBeNull();
    expect(parseBoxQr("inventory:box:SHORT")).toBeNull();
    expect(parseBoxQr("inventory:box:ABCDEFGHIO")).toBeNull(); // I and O are never issued
    expect(parseBoxQr("ABCDEFGH23")).toBeNull(); // must carry the prefix
    expect(parseBoxQr("https://example.com")).toBeNull();
  });
});

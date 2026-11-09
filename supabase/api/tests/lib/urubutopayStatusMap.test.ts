import { describe, it, expect } from "vitest";
import { mapUrubutoStatus } from "../../src/lib/urubutopay/statusMap.js";

describe("mapUrubutoStatus", () => {
  it.each([
    ["INITIATED", "PENDING"],
    ["initiated", "PENDING"],
    ["PENDING", "PENDING"],
    ["SUCCESSFUL", "SUCCESSFUL"],
    ["successful", "SUCCESSFUL"],
    ["FAILED", "FAILED"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapUrubutoStatus(input)).toBe(expected);
  });

  it("falls back to PENDING for null/undefined", () => {
    expect(mapUrubutoStatus(null)).toBe("PENDING");
    expect(mapUrubutoStatus(undefined)).toBe("PENDING");
  });

  it("falls back to PENDING for an unrecognized status — never silently SUCCESSFUL", () => {
    expect(mapUrubutoStatus("SOME_NEW_STATUS")).toBe("PENDING");
  });
});

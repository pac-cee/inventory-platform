import { describe, it, expect } from "vitest";
import { itemLabel } from "./item-label";

describe("itemLabel", () => {
  it("is type · name · model", () => {
    expect(itemLabel({ type: "Cable", name: "USB-A to C", model: "1m" })).toBe("Cable · USB-A to C · 1m");
  });
  it("leaves out the placeholder model and a name that repeats the type", () => {
    expect(itemLabel({ type: "Cable", name: "USB-A to C", model: "Unspecified" })).toBe("Cable · USB-A to C");
    expect(itemLabel({ type: "Laptop", name: "Laptop", model: "X1" })).toBe("Laptop · X1");
  });
  it("falls back to the name for an old server that does not send a type", () => {
    expect(itemLabel({ name: "Hex key set" })).toBe("Hex key set");
  });
});

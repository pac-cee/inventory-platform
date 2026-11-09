import { describe, it, expect } from "vitest";
import { itemLabel, itemLabelSql } from "../../src/lib/itemLabel.js";

describe("itemLabel", () => {
  it("is type · name · model", () => {
    expect(itemLabel({ type: "Cable", name: "USB-A to C", model: "1m" })).toBe("Cable · USB-A to C · 1m");
  });
  it("leaves out the 'Unspecified' placeholder model", () => {
    expect(itemLabel({ type: "Cable", name: "USB-A to C", model: "Unspecified" })).toBe("Cable · USB-A to C");
    expect(itemLabel({ type: "Cable", name: "USB-A to C" })).toBe("Cable · USB-A to C");
  });
  it("leaves out a name that only repeats the type, so it does not stutter", () => {
    expect(itemLabel({ type: "Screwdriver", name: "Screwdriver", model: "PH2" })).toBe("Screwdriver · PH2");
    expect(itemLabel({ type: "Screwdriver", name: "Screwdriver", model: "Unspecified" })).toBe("Screwdriver");
  });
  it("is just the type when that is all there is", () => {
    expect(itemLabel({ type: "Laptop", name: "Laptop", model: null })).toBe("Laptop");
  });
});

describe("itemLabelSql", () => {
  it("applies the same three rules, against the alias it is given", () => {
    const sql = itemLabelSql("it");
    expect(sql).toContain("it.type");
    expect(sql).toContain("case when it.name <> it.type then it.name end");
    expect(sql).toContain("nullif(it.model, 'Unspecified')");
    expect(sql).toContain("' · '");
  });
});

import { describe, it, expect } from "vitest";
import { UNCATEGORIZED, categoryHref, filterByCategory, uncategorizedCount } from "./category-filter";

const items = [
  { category: "Cables" },
  { category: "Cables" },
  { category: "cables" },
  { category: "Tools" },
  { category: null },
  { category: "  " },
];

describe("category filter", () => {
  it("shows everything when no category is chosen", () => {
    expect(filterByCategory(items, undefined)).toHaveLength(6);
    expect(filterByCategory(items, "")).toHaveLength(6);
  });
  it("matches the name exactly, as the category list does", () => {
    expect(filterByCategory(items, "Cables")).toHaveLength(2);
    expect(filterByCategory(items, "cables")).toHaveLength(1);
  });
  it("finds the items with no category, blank included", () => {
    expect(filterByCategory(items, UNCATEGORIZED)).toHaveLength(2);
    expect(uncategorizedCount(items)).toBe(2);
  });
  it("an unknown category gives nothing, not everything", () => {
    expect(filterByCategory(items, "Nope")).toHaveLength(0);
  });
  it("builds links that keep the search and jump to the table", () => {
    expect(categoryHref(null)).toBe("/items#catalog");
    expect(categoryHref("Cables & Wires")).toBe("/items?category=Cables+%26+Wires#catalog");
    expect(categoryHref("Cables", "usb")).toBe("/items?q=usb&category=Cables#catalog");
    expect(categoryHref(UNCATEGORIZED)).toBe("/items?category=__none#catalog");
  });
});

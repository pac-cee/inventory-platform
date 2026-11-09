import { describe, it, expect } from "vitest";
import { itemPages } from "./revalidate";

/**
 * A photo uploaded on an item's detail page was visible there but missing from
 * the catalog list, because the list's cached render was never cleared. These
 * pin the set of pages an item edit has to refresh.
 */

describe("itemPages", () => {
  const pages = itemPages("abc-123");

  it("includes the catalog list — the page the bug was visible on", () => {
    expect(pages).toContain("/items");
  });

  it("includes the item's own page", () => {
    expect(pages).toContain("/items/abc-123");
  });

  it("includes the dashboard, which lists items with their thumbnails", () => {
    expect(pages).toContain("/");
  });

  it("includes the locations page, which names the items stored in each", () => {
    expect(pages).toContain("/locations");
  });

  it("does not confuse the list with the item's own page", () => {
    // "/items" must be its own entry; `/items/${id}` does not clear the list.
    expect(pages.filter((p) => p === "/items")).toHaveLength(1);
    expect(pages).not.toEqual([`/items/abc-123`, "/", "/locations"]);
  });

  it("names each page once, so nothing is revalidated twice", () => {
    expect(new Set(pages).size).toBe(pages.length);
  });
});

import { describe, it, expect } from "vitest";
import { PAGE_SIZE, pageCount, clampPage, pageOf, pageRange } from "./paginate";

const catalog = Array.from({ length: 106 }, (_, i) => i + 1);

describe("pageCount", () => {
  it("counts a partial last page", () => {
    expect(pageCount(106)).toBe(3);
    expect(pageCount(100)).toBe(2);
    expect(pageCount(1)).toBe(1);
  });

  it("is 1 for an empty list, so the footer never says 'of 0'", () => {
    expect(pageCount(0)).toBe(1);
  });
});

describe("clampPage", () => {
  it("pulls a page past the end back to the last one", () => {
    expect(clampPage(99, 106)).toBe(3);
  });

  it("treats junk and out-of-range low values as page 1", () => {
    for (const p of [undefined, null, "", "abc", 0, -4, NaN]) {
      expect(clampPage(p, 106)).toBe(1);
    }
  });

  it("accepts the string a query param actually arrives as", () => {
    expect(clampPage("2", 106)).toBe(2);
  });
});

describe("pageOf", () => {
  it("shows the first 50 on page 1", () => {
    expect(pageOf(catalog, 1)).toEqual(catalog.slice(0, 50));
  });

  it("shows the next 50 on page 2 — the rows that used to be invisible", () => {
    const second = pageOf(catalog, 2);
    expect(second).toHaveLength(50);
    expect(second[0]).toBe(51);
  });

  it("shows the remainder on the last page", () => {
    expect(pageOf(catalog, 3)).toEqual([101, 102, 103, 104, 105, 106]);
  });

  it("reaches every row across the pages, with none repeated", () => {
    const seen = [pageOf(catalog, 1), pageOf(catalog, 2), pageOf(catalog, 3)].flat();
    expect(seen).toEqual(catalog);
  });

  it("returns the last page rather than nothing when the page is too high", () => {
    expect(pageOf(catalog, 42)).toEqual(pageOf(catalog, 3));
  });

  it("is empty for an empty list", () => {
    expect(pageOf([], 1)).toEqual([]);
  });
});

describe("pageRange", () => {
  it("numbers the rows on the page, 1-based and inclusive", () => {
    expect(pageRange(2, 106)).toEqual({ from: 51, to: 100, page: 2, pages: 3 });
  });

  it("stops `to` at the total on a partial last page", () => {
    expect(pageRange(3, 106)).toEqual({ from: 101, to: 106, page: 3, pages: 3 });
  });

  it("reads 0–0 when there is nothing to show", () => {
    expect(pageRange(1, 0)).toEqual({ from: 0, to: 0, page: 1, pages: 1 });
  });
});

describe("PAGE_SIZE", () => {
  it("is 50 — what the screens showed before paging existed", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

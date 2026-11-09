import { describe, it, expect } from "vitest";
import { placeText, stockSummary, type StockPlace } from "./stock-summary";

const place = (over: Partial<StockPlace>): StockPlace => ({
  location_id: "l",
  path: "Hardware Area › Shelves › Shelf 2 › Level 3",
  kind: "level",
  label: null,
  quantity: 4,
  ...over,
});

describe("placeText", () => {
  it("names a box by what it is for, then where it is", () => {
    expect(placeText(place({ kind: "box", label: "USB-A to C cables", path: "Shelf 2 › Box 4" }))).toBe(
      "Box “USB-A to C cables” · Shelf 2 › Box 4",
    );
  });
  it("a box with no label is still marked as a box", () => {
    expect(placeText(place({ kind: "box", label: null, path: "Shelf 2 › Box 4" }))).toBe("Box · Shelf 2 › Box 4");
  });
  it("any other place is just its path", () => {
    expect(placeText(place({ path: "Main Hall" }))).toBe("Main Hall");
  });
});

describe("stockSummary", () => {
  it("says none are in stock when there is nothing on a shelf", () => {
    expect(stockSummary(0, [])).toEqual({ count: "None in stock", where: null, inStock: false });
  });
  it("says how many and where the most are", () => {
    const s = stockSummary(7, [place({ kind: "box", label: "Pis", path: "Shelf 2 › Box 4", quantity: 5 })]);
    expect(s).toEqual({ count: "7 in stock", where: "Box “Pis” · Shelf 2 › Box 4", inStock: true });
  });
  it("mentions the other places", () => {
    const s = stockSummary(9, [place({ path: "A" }), place({ path: "B" }), place({ path: "C" })]);
    expect(s.where).toBe("A (+2 more places)");
    expect(stockSummary(9, [place({ path: "A" }), place({ path: "B" })]).where).toBe("A (+1 more place)");
  });
});

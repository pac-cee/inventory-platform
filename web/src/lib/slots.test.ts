import { describe, it, expect } from "vitest";
import { slotLabel, bySlotThenName } from "./slots";

describe("slotLabel", () => {
  it("reads as #n", () => {
    expect(slotLabel(1)).toBe("#1");
    expect(slotLabel(12)).toBe("#12");
  });

  it("shows a dash for stock that predates numbering", () => {
    expect(slotLabel(null)).toBe("—");
    expect(slotLabel(undefined)).toBe("—");
    // 0 is not a number anyone was given — numbering starts at 1.
    expect(slotLabel(0)).toBe("—");
  });
});

describe("bySlotThenName", () => {
  const sort = (rows: { slot_no?: number | null; name?: string }[]) =>
    rows.slice().sort(bySlotThenName).map((r) => r.name);

  it("orders by the number on the shelf, not alphabetically", () => {
    expect(
      sort([
        { slot_no: 3, name: "Anvil" },
        { slot_no: 1, name: "Zebra cable" },
        { slot_no: 2, name: "Monitor" },
      ]),
    ).toEqual(["Zebra cable", "Monitor", "Anvil"]);
  });

  it("sorts unnumbered rows last instead of first", () => {
    expect(
      sort([
        { slot_no: null, name: "Old row" },
        { slot_no: 2, name: "Monitor" },
        { slot_no: 1, name: "Cable" },
      ]),
    ).toEqual(["Cable", "Monitor", "Old row"]);
  });

  it("falls back to the name when neither row has a number", () => {
    expect(
      sort([
        { slot_no: null, name: "Beta" },
        { slot_no: null, name: "Alpha" },
      ]),
    ).toEqual(["Alpha", "Beta"]);
  });

  it("is stable enough to leave equal numbers ordered by name", () => {
    // Two locations' rows never share a number, but a filtered list can hold
    // rows from more than one place.
    expect(
      sort([
        { slot_no: 1, name: "Beta" },
        { slot_no: 1, name: "Alpha" },
      ]),
    ).toEqual(["Alpha", "Beta"]);
  });
});

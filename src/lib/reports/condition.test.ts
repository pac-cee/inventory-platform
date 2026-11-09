import { describe, it, expect } from "vitest";
import { conditionText, percent, recommendationText, specificationText } from "./condition";
import type { ConditionRow } from "@/lib/api/types";

const row = (over: Partial<ConditionRow> = {}): ConditionRow =>
  ({
    item_id: "i",
    location_id: "l",
    type: "HP",
    name: "Base",
    model: "Base",
    sku: "vrlt-hpx-001",
    specification: null,
    category: "Computer Laptop",
    package_label: null,
    units_per_container: 1,
    location_name: "Shelf",
    room_id: "r",
    room_name: "Room",
    total: 10,
    available: 10,
    damaged: 0,
    operational: 10,
    in_use: 0,
    faults: [],
    accounted: 0,
    ...over,
  }) as ConditionRow;

describe("conditionText", () => {
  it("says Good when nothing is damaged", () => {
    expect(conditionText(row())).toBe("Good");
  });

  it("tallies the good count and each fault", () => {
    const r = row({
      total: 28,
      damaged: 19,
      operational: 9,
      accounted: 19,
      faults: [
        { note: "batteries died", units: 12, recommendation: "Replace batteries" },
        { note: "Broken screen", units: 1, recommendation: null },
      ],
    });
    expect(conditionText(r)).toBe("9 good, 12 batteries died, 1 Broken screen");
  });

  it("calls out damage with no fault behind it", () => {
    const r = row({ total: 10, damaged: 3, operational: 7, accounted: 0, faults: [] });
    expect(conditionText(r)).toBe("7 good, 3 out of service (reason not recorded)");
  });
});

describe("percent", () => {
  // The figure from the report this feature was specified against: 9 of 28.
  it("matches the printed 32.1%", () => {
    expect(percent(row({ total: 28, operational: 9 }))).toBe(32.1);
  });

  it("is 0 rather than NaN when nothing is owned", () => {
    expect(percent(row({ total: 0, operational: 0 }))).toBe(0);
  });
});

describe("recommendationText", () => {
  it("lists each distinct fix once", () => {
    const r = row({
      faults: [
        { note: "a", units: 1, recommendation: "Repair the broken" },
        { note: "b", units: 1, recommendation: "Repair the broken" },
        { note: "c", units: 1, recommendation: "Reorder" },
      ],
    });
    expect(recommendationText(r)).toBe("Repair the broken; Reorder");
  });

  it("is empty when no fault carries one", () => {
    expect(recommendationText(row({ faults: [{ note: "a", units: 1, recommendation: null }] }))).toBe(
      "",
    );
  });
});

describe("specificationText", () => {
  it("returns the specification", () => {
    expect(specificationText(row({ specification: "16GB RAM" }))).toBe("16GB RAM");
  });

  it("falls back to a dash when absent or blank", () => {
    expect(specificationText(row({ specification: null }))).toBe("—");
    expect(specificationText(row({ specification: "   " }))).toBe("—");
  });
});

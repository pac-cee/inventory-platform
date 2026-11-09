import { describe, it, expect } from "vitest";
import {
  groupVariants,
  locationsText,
  nestByName,
  namePercent,
  skuText,
  itemText,
  variantsText,
  groupConditionText,
  groupPercent,
  groupRecommendationText,
} from "./condition-group";
import type { ConditionRow } from "@/lib/api/types";

const row = (over: Partial<ConditionRow> = {}): ConditionRow =>
  ({
    item_id: "i",
    location_id: "l",
    type: "Dell Latitude 5420",
    name: "Base",
    model: "Base",
    sku: "vrlt-dll-001",
    specification: null,
    category: "Computers",
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
    suggestions: [],
    accounted: 0,
    ...over,
  }) as ConditionRow;

describe("groupVariants", () => {
  it("adds up spec-only variants of one product at one location", () => {
    // One identity (type, name, model) on both, so only the specification
    // differs — that is the variant case and the counts combine.
    const g = groupVariants([
      row({ item_id: "a", specification: "8GB RAM", total: 9, operational: 9 }),
      row({ item_id: "b", specification: "16GB RAM", total: 6, operational: 6 }),
    ], "location");
    expect(g).toHaveLength(1);
    expect(g[0].total).toBe(15);
    expect(g[0].variants).toHaveLength(2);
  });

  it("keeps different names apart", () => {
    const g = groupVariants([row({ type: "Latitude" }), row({ type: "ProDesk" })], "location");
    expect(g).toHaveLength(2);
  });

  it("keeps the same name in different categories apart", () => {
    const g = groupVariants([row({ category: "Computers" }), row({ category: "Spares" })], "location");
    expect(g).toHaveLength(2);
  });

  it("keeps the same product in different locations apart", () => {
    const g = groupVariants([row({ location_id: "l1" }), row({ location_id: "l2" })], "location");
    expect(g).toHaveLength(2);
  });

  it("matches names case-insensitively and ignores stray spacing", () => {
    const g = groupVariants([row({ type: "Latitude 5420" }), row({ type: " latitude 5420 " })], "location");
    expect(g).toHaveLength(1);
    expect(g[0].total).toBe(20);
  });

  it("sums damage and faults across variants", () => {
    const g = groupVariants([
      row({
        specification: "8GB",
        total: 10,
        damaged: 2,
        operational: 8,
        accounted: 2,
        faults: [{ note: "battery dead", units: 2, recommendation: "Replace batteries" }],
      }),
      row({ specification: "16GB", total: 10, damaged: 0, operational: 10 }),
    ], "location");
    expect(g[0].total).toBe(20);
    expect(g[0].damaged).toBe(2);
    expect(g[0].operational).toBe(18);
    expect(groupConditionText(g[0])).toBe("18 good, 2 battery dead");
    expect(groupPercent(g[0])).toBe(90);
    expect(groupRecommendationText(g[0])).toBe("Replace batteries");
  });
});

describe("variantsText", () => {
  it("shows the plain spec when there is only one", () => {
    const [g] = groupVariants([row({ specification: "16GB RAM" })], "location");
    expect(variantsText(g)).toBe("16GB RAM");
  });

  it("falls back to a dash when the only variant has no spec", () => {
    const [g] = groupVariants([row({ specification: null })], "location");
    expect(variantsText(g)).toBe("—");
  });

  it("lists each variant with its share when there are several", () => {
    const [g] = groupVariants([
      row({ item_id: "a", specification: "8GB RAM", total: 9 }),
      row({ item_id: "b", specification: "16GB RAM", total: 6 }),
    ], "location");
    expect(variantsText(g)).toBe("8GB RAM (9), 16GB RAM (6)");
  });

  it("names an unspecified variant rather than leaving a gap", () => {
    const [g] = groupVariants([
      row({ item_id: "a", specification: null, total: 3 }),
      row({ item_id: "b", specification: "16GB RAM", total: 6 }),
    ], "location");
    expect(variantsText(g)).toBe("unspecified (3), 16GB RAM (6)");
  });
});

describe("suggestions on a grouped line", () => {
  it("appear in the recommendation, marked as suggestions", () => {
    const [g] = groupVariants([
      row({
        suggestions: [{ note: "Upgrade to 16GB RAM", kind: "upgrade", units: null }],
      }),
    ], "location");
    expect(groupRecommendationText(g)).toBe("Upgrade to 16GB RAM (suggested)");
  });

  it("sit after the fixes when both are present", () => {
    const [g] = groupVariants([
      row({
        damaged: 1,
        operational: 9,
        accounted: 1,
        faults: [{ note: "battery dead", units: 1, recommendation: "Replace batteries" }],
        suggestions: [{ note: "Fit an SSD", kind: "upgrade", units: null }],
      }),
    ], "location");
    expect(groupRecommendationText(g)).toBe("Replace batteries; Fit an SSD (suggested)");
  });

  it("do not touch the condition tally or the percentage", () => {
    const [g] = groupVariants([
      row({ total: 10, operational: 10, damaged: 0, suggestions: [{ note: "More RAM", kind: "upgrade", units: null }] }),
    ], "location");
    expect(groupConditionText(g)).toBe("Good");
    expect(groupPercent(g)).toBe(100);
  });
});

describe("item-first grouping", () => {
  it("adds one product up across every location", () => {
    const g = groupVariants(
      [
        row({ location_id: "l1", location_name: "Storeroom", room_id: "r1", total: 5, operational: 5 }),
        row({ location_id: "l2", location_name: "Lab A", room_id: "r2", total: 3, operational: 3 }),
      ],
      "item",
    );
    expect(g).toHaveLength(1);
    expect(g[0].total).toBe(8);
    expect(locationsText(g[0])).toBe("Storeroom (5), Lab A (3)");
  });

  it("still splits by category, since that is what the report groups on", () => {
    const g = groupVariants(
      [row({ category: "Computers" }), row({ category: "Spares" })],
      "item",
    );
    expect(g).toHaveLength(2);
  });

  it("location mode keeps one line per place", () => {
    const g = groupVariants(
      [
        row({ location_id: "l1", location_name: "Storeroom", room_id: "r1" }),
        row({ location_id: "l2", location_name: "Lab A", room_id: "r2" }),
      ],
      "location",
    );
    expect(g).toHaveLength(2);
  });

  it("merges variants across locations too", () => {
    const g = groupVariants(
      [
        row({ item_id: "a", specification: "8GB", location_id: "l1", location_name: "Storeroom", total: 4 }),
        row({ item_id: "b", specification: "16GB", location_id: "l2", location_name: "Lab A", total: 6 }),
      ],
      "item",
    );
    expect(g).toHaveLength(1);
    expect(g[0].total).toBe(10);
    expect(g[0].variants).toHaveLength(2);
    expect(g[0].locations).toHaveLength(2);
  });

  it("names a single location plainly", () => {
    const [g] = groupVariants([row({ location_name: "Storeroom" })], "item");
    expect(locationsText(g)).toBe("Storeroom");
  });

  it("sums the same place appearing twice", () => {
    const g = groupVariants(
      [
        row({ item_id: "a", specification: "8GB", location_name: "Storeroom", total: 4 }),
        row({ item_id: "b", specification: "16GB", location_name: "Storeroom", total: 6 }),
      ],
      "item",
    );
    expect(g[0].locations).toEqual([{ name: "Storeroom", total: 10 }]);
  });
});

describe("name separates items; specification does not", () => {
  it("keeps two names apart even under one type", () => {
    const g = groupVariants(
      [
        row({ item_id: "a", name: "CPU-08", specification: "8GB", total: 9 }),
        row({ item_id: "b", name: "CPU-16", specification: "16GB", total: 6 }),
      ],
      "item",
    );
    expect(g).toHaveLength(2);
    expect(g[0].total).toBe(9);
    expect(g[1].total).toBe(6);
  });

  it("combines entries with one identity that differ only by specification", () => {
    const g = groupVariants(
      [
        row({ item_id: "a", specification: "8GB", total: 9 }),
        row({ item_id: "b", specification: "16GB", total: 6 }),
      ],
      "item",
    );
    expect(g).toHaveLength(1);
    expect(g[0].total).toBe(15);
    expect(g[0].variants).toHaveLength(2);
  });

  it("does not fold two different names together", () => {
    const g = groupVariants(
      [row({ item_id: "a", name: "CPU-08" }), row({ item_id: "b" })],
      "item",
    );
    expect(g).toHaveLength(2);
  });

  it("matches names case-insensitively", () => {
    const g = groupVariants(
      [row({ item_id: "a", name: "CPU-08" }), row({ item_id: "b", name: "cpu-08" })],
      "item",
    );
    expect(g).toHaveLength(1);
  });
});

describe("nestByName", () => {
  it("puts one type's items under a single heading", () => {
    const lines = groupVariants(
      [
        row({ item_id: "a", name: "CPU-08", total: 9, operational: 9 }),
        row({ item_id: "b", name: "CPU-16", total: 6, operational: 6 }),
      ],
      "item",
    );
    const names = nestByName(lines);
    expect(names).toHaveLength(1);
    expect(names[0].lines).toHaveLength(2);
    // The heading carries the combined total, the lines keep their own.
    expect(names[0].total).toBe(15);
    expect(namePercent(names[0])).toBe(100);
  });

  it("keeps different types apart", () => {
    const lines = groupVariants(
      [row({ type: "Latitude" }), row({ type: "ProDesk" })],
      "item",
    );
    expect(nestByName(lines)).toHaveLength(2);
  });

  it("keeps one type in two categories apart", () => {
    const lines = groupVariants(
      [row({ category: "Computers" }), row({ category: "Spares" })],
      "item",
    );
    expect(nestByName(lines)).toHaveLength(2);
  });

  it("averages the type's percentage over its items, not per line", () => {
    const lines = groupVariants(
      [
        row({ item_id: "a", name: "A", total: 10, operational: 5, damaged: 5, accounted: 5 }),
        row({ item_id: "b", name: "B", total: 10, operational: 10 }),
      ],
      "item",
    );
    const [g] = nestByName(lines);
    expect(g.total).toBe(20);
    expect(namePercent(g)).toBe(75);
  });
});

describe("itemText", () => {
  it("pairs the name with the model", () => {
    const [g] = groupVariants([row({ name: "Patch Lead", model: "CAT6-3M" })], "item");
    expect(itemText(g)).toBe("Patch Lead · CAT6-3M");
  });

  it("drops the placeholder model that 0039 backfilled, rather than printing it", () => {
    const [g] = groupVariants([row({ name: "Patch Lead", model: "Unspecified" })], "item");
    expect(itemText(g)).toBe("Patch Lead");
  });
});

describe("skuText", () => {
  it("prints the assigned SKU", () => {
    const [g] = groupVariants([row({ sku: "vrlt-cbl-001" })], "item");
    expect(skuText(g)).toBe("vrlt-cbl-001");
  });

  it("lists every SKU folded into one line", () => {
    const g = groupVariants(
      [
        row({ item_id: "a", location_id: "l1", sku: "vrlt-cbl-001" }),
        row({ item_id: "b", location_id: "l2", sku: "vrlt-cbl-001" }),
      ],
      "item",
    );
    // One item in two places is one line carrying its single SKU once.
    expect(skuText(g[0])).toBe("vrlt-cbl-001");
  });
});

describe("one item in many places", () => {
  // The bug this covers: five location rows for one item printed the SKU and
  // the specification five times each.
  const spread = () =>
    groupVariants(
      [
        row({ name: "Hp-12", specification: "Computer to use for research", location_name: "Home", location_id: "l1", total: 4, operational: 4 }),
        row({ name: "Hp-12", specification: "Computer to use for research", location_name: "Level-1", location_id: "l2", total: 3, operational: 3 }),
        row({ name: "Hp-12", specification: "Computer to use for research", location_name: "Level-2", location_id: "l3", total: 1, operational: 1 }),
        row({ name: "Hp-12", specification: "Computer to use for research", location_name: "Lab A", location_id: "l4", total: 2, operational: 2 }),
        row({ name: "Hp-12", specification: "Computer to use for research", location_name: "Ware House", location_id: "l5", total: 2, operational: 2 }),
      ],
      "item",
    );

  it("names the SKU once, not once per location", () => {
    const [g] = spread();
    // One item in five places: its SKU is folded in once, not five times.
    expect(g.skus).toEqual(["vrlt-dll-001"]);
    expect(skuText(g)).toBe("vrlt-dll-001");
  });

  it("names the specification once, not once per location", () => {
    const [g] = spread();
    expect(g.variants).toHaveLength(1);
    expect(variantsText(g)).toBe("Computer to use for research");
  });

  it("still totals every location", () => {
    const [g] = spread();
    expect(g.total).toBe(12);
    expect(g.locations).toHaveLength(5);
    expect(locationsText(g)).toBe("Home (4), Level-1 (3), Level-2 (1), Lab A (2), Ware House (2)");
  });

  it("keeps genuinely different specs apart, summing each", () => {
    const g = groupVariants(
      [
        row({ specification: "8GB", location_id: "l1", location_name: "Home", total: 4 }),
        row({ specification: "8GB", location_id: "l2", location_name: "Lab", total: 3 }),
        row({ specification: "16GB", location_id: "l1", location_name: "Home", total: 2 }),
      ],
      "item",
    );
    expect(g).toHaveLength(1);
    expect(g[0].variants).toHaveLength(2);
    expect(variantsText(g[0])).toBe("8GB (7), 16GB (2)");
  });
});

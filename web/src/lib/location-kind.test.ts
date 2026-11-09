import { describe, it, expect } from "vitest";
import { kindBadge, kindFields } from "./location-kind";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("kindBadge", () => {
  it("only boxes get a badge", () => {
    expect(kindBadge("box", "USB-C cables")).toBe("Box · USB-C cables");
    expect(kindBadge("box")).toBe("Box");
    expect(kindBadge("shelf")).toBeNull();
    expect(kindBadge("area")).toBeNull();
    expect(kindBadge(undefined)).toBeNull();
  });
});

describe("kindFields", () => {
  it("sends nothing when the form has no type (older forms keep working)", () => {
    expect(kindFields(form({ name: "x" }))).toEqual({});
  });
  it("sends kind and the box label", () => {
    expect(kindFields(form({ kind: "box", label: "  M3 screws " }))).toEqual({ kind: "box", label: "M3 screws" });
  });
  it("an empty box label becomes null, not an empty string", () => {
    expect(kindFields(form({ kind: "box", label: "  " }))).toEqual({ kind: "box", label: null });
  });
  it("drops the label for anything that is not a box, clearing a stale one", () => {
    expect(kindFields(form({ kind: "shelf", label: "left over" }))).toEqual({ kind: "shelf", label: null });
  });
  it("ignores a kind it does not know", () => {
    expect(kindFields(form({ kind: "crate" }))).toEqual({});
  });
});

import { kindsAllowedUnder, kindsForEdit, canHoldSubLocations, isOlderUntypedPlace } from "./location-kind";

describe("Area > Shelf > Level > Box", () => {
  it("only an area can be created at the top", () => {
    expect(kindsAllowedUnder(null)).toEqual(["area"]);
  });
  it("each step offers exactly the next one down", () => {
    expect(kindsAllowedUnder("area")).toEqual(["shelf"]);
    expect(kindsAllowedUnder("shelf")).toEqual(["level"]);
    expect(kindsAllowedUnder("level")).toEqual(["box"]);
  });
  it("a box holds nothing below it, and cannot be offered at the top or on a shelf", () => {
    expect(kindsAllowedUnder("box")).toEqual([]);
    expect(canHoldSubLocations("box")).toBe(false);
    expect(canHoldSubLocations("level")).toBe(true);
    expect(kindsAllowedUnder(null)).not.toContain("box");
    expect(kindsAllowedUnder("shelf")).not.toContain("box");
  });
  it("editing an older place keeps its own kind available", () => {
    expect(kindsForEdit("area", "level")).toEqual(["box", "area"]);
    expect(kindsForEdit("shelf", "area")).toEqual(["shelf"]);
  });
});

describe("older places without a type", () => {
  it("an area inside a shelf or level is an old place needing its type", () => {
    expect(isOlderUntypedPlace("area", "shelf")).toBe(true);
    expect(isOlderUntypedPlace(null, "level")).toBe(true); // no kind recorded = area
  });
  it("a grouping area inside an area, a top-level area and typed places are fine", () => {
    expect(isOlderUntypedPlace("area", "area")).toBe(false);
    expect(isOlderUntypedPlace("area", null)).toBe(false);
    expect(isOlderUntypedPlace("shelf", "area")).toBe(false);
  });
});

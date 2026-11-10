import { describe, it, expect } from "vitest";
import { shelfLevels, snapShelf, emptyShelfCopy } from "./builder";
describe("shelf builder", () => {
  it("preserves table type when duplicating", () => {
    expect(
      emptyShelfCopy(
        {
          id: "t",
          name: "Desk",
          kind: "table",
          x: 0,
          z: 0,
          rotation: 0,
          items: [],
        },
        "prototype-t",
      ).kind,
    ).toBe("table");
  });
  it("keeps enough levels for existing boxes", () => {
    expect(shelfLevels(1, 13)).toBe(4);
    expect(shelfLevels(5, 0)).toBe(5);
  });
  it("snaps movement to half metres inside the floor", () => {
    expect(snapShelf({ x: 12.2, z: -6.2, rotation: 90 })).toEqual({
      x: 12,
      z: -6,
      rotation: 90,
    });
    expect(snapShelf({ x: 40, z: -30, rotation: 0 })).toEqual({
      x: 17.5,
      z: -11.5,
      rotation: 0,
    });
    expect(snapShelf({ x: 1.3, z: 2.1, rotation: 0 }).x).toBe(1.5);
  });
  it("duplicates structure without duplicating inventory", () => {
    const copy = emptyShelfCopy(
      {
        id: "a",
        name: "Lab",
        x: 0,
        z: 0,
        rotation: 0,
        levels: 5,
        items: [{ id: "i", name: "Pi", type: "Pi", quantity: 8, capacity: 10 }],
      },
      "prototype-b",
    );
    expect(copy.items).toEqual([]);
    expect(copy.levels).toBe(5);
    expect(copy.id).toBe("prototype-b");
  });
});

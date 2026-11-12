import { describe, expect, it } from "vitest";
import { shelfFill, clampPlacement, readLayout, isShelf, isFurniture, planId } from "./model";
import { DESKS } from "./verlet-site";

describe("spatial inventory", () => {
  it("renders an empty shelf when stock is zero", () => {
    expect(shelfFill(0, 100)).toBe(0);
  });
  it("shows stock proportionally without drawing one object per unit", () => {
    expect(shelfFill(25, 100)).toBe(3);
    expect(shelfFill(10000, 10000)).toBe(12);
    expect(shelfFill(1, 100)).toBe(1);
    expect(shelfFill(8, 8)).toBe(8);
  });
  it("keeps a shelf within Verlet's floor", () => {
    expect(clampPlacement({ x: 500, z: -500, rotation: 91 })).toEqual({
      x: 11.5,
      z: -11.5,
      rotation: 90,
    });
  });
  it("ignores malformed persisted layouts", () => {
    expect(readLayout("{broken")).toEqual({});
    expect(readLayout('{"a":{"x":"bad","z":2,"rotation":0}}')).toEqual({});
    expect(readLayout('{"a":{"x":2,"z":3,"rotation":90}}')).toEqual({
      a: { x: 2, z: 3, rotation: 90 },
    });
  });
});

describe("desks and furniture", () => {
  it("keeps a desk's whole footprint in the hall or behind the north wall, never in the wall", () => {
    expect(clampPlacement({ x: 0, z: -11.8, rotation: 0 }, "workstation").z).toBe(-11);
    expect(clampPlacement({ x: 0, z: -12.2, rotation: 0 }, "workstation").z).toBe(-13);
    expect(clampPlacement({ x: 0, z: -17, rotation: 0 }, "workstation").z).toBe(-17);
    expect(clampPlacement({ x: 40, z: 40, rotation: 0 }, "workstation")).toMatchObject({ x: 10.95, z: 11 });
    // turned, it is deeper than it is wide
    expect(clampPlacement({ x: 40, z: 40, rotation: 90 }, "workstation")).toMatchObject({ x: 11, z: 10.95 });
  });
  it("turns in steps of 90 degrees", () => {
    expect(clampPlacement({ x: 0, z: 0, rotation: 450 }, "workstation").rotation).toBe(90);
    expect(clampPlacement({ x: 0, z: 0, rotation: -90 }, "workstation").rotation).toBe(270);
  });
  it("leaves every desk where the floor plan put it", () => {
    for (const desk of DESKS)
      expect(clampPlacement(desk, "workstation")).toMatchObject({ x: desk.x, z: desk.z, rotation: desk.rotation });
  });
  it("tells shelves from furniture, and keeps furniture out of a device's saved layout", () => {
    expect(isShelf({})).toBe(true);
    expect(isShelf({ kind: "desk" })).toBe(false);
    expect(isFurniture({ kind: "piece" })).toBe(true);
    expect(planId("desk:soft-workstation-3")).toBe("soft-workstation-3");
    const saved = JSON.stringify({
      "desk:soft-workstation-3": { x: 1, z: 1, rotation: 0 },
      "piece:plant-sw": { x: 1, z: 1, rotation: 0 },
      shelf: { x: 1, z: 1, rotation: 0 },
    });
    expect(Object.keys(readLayout(saved))).toEqual(["shelf"]);
  });
});

import { describe, expect, it } from "vitest";
import { shelfFill, clampPlacement, readLayout, isShelf, isDeskId } from "./model";
import { DESKS, REPLACED } from "./verlet-site";

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
      x: 17.5,
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

describe("desks", () => {
  it("keeps a desk in the hall or the small offices, never in the wall or corridor", () => {
    expect(clampPlacement({ x: 0, z: -11.8, rotation: 0 }, true).z).toBe(-10.9);
    expect(clampPlacement({ x: 0, z: -14, rotation: 0 }, true).z).toBe(-15.1);
    expect(clampPlacement({ x: 0, z: -17, rotation: 0 }, true).z).toBe(-17);
    expect(clampPlacement({ x: 40, z: 40, rotation: 0 }, true)).toMatchObject({ x: 16.9, z: 10.9 });
  });
  it("turns in steps of 90 degrees", () => {
    expect(clampPlacement({ x: 0, z: 0, rotation: 450 }, true).rotation).toBe(90);
    expect(clampPlacement({ x: 0, z: 0, rotation: -90 }, true).rotation).toBe(270);
  });
  it("leaves every desk where the floor plan put it", () => {
    for (const desk of DESKS) expect(clampPlacement(desk, true)).toMatchObject({ x: desk.x, z: desk.z, rotation: desk.rotation });
    expect(new Set(DESKS.map((desk) => desk.name)).size).toBe(DESKS.length);
    expect(DESKS.every((desk) => REPLACED.has(desk.id))).toBe(true);
  });
  it("tells shelves from furniture", () => {
    expect(isShelf({})).toBe(true);
    expect(isShelf({ kind: "desk" })).toBe(false);
    expect(isDeskId("desk:soft-workstation-3")).toBe(true);
  });
});

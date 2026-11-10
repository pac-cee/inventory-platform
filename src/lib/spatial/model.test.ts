import { describe, expect, it } from "vitest";
import { shelfFill, clampPlacement, readLayout } from "./model";

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

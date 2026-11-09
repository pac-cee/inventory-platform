import { expect, it } from "vitest";
import { findFloorRoute, officeObstacles, shelfApproach } from "./directions";
it("routes from the entrance to each sample shelf without crossing obstacles", () => {
  const shelves = [
    { id: "a", name: "A", x: -6, z: -3, rotation: 0, items: [] },
    { id: "b", name: "B", x: -2, z: -3, rotation: 0, items: [] },
    { id: "c", name: "C", x: 2, z: -3, rotation: 0, items: [] },
  ];
  const obstacles = officeObstacles(shelves);
  for (const shelf of shelves) {
    const route = findFloorRoute(
      { x: 0, z: 6 },
      shelfApproach(shelf),
      obstacles,
    );
    expect(route).not.toBeNull();
    for (const p of route!.points)
      expect(
        obstacles.some(
          (o) =>
            p.x >= o.minX && p.x <= o.maxX && p.z >= o.minZ && p.z <= o.maxZ,
        ),
      ).toBe(false);
    expect(route!.distance).toBeGreaterThan(0);
  }
});
it("reports a blocked route rather than drawing through furniture", () => {
  expect(
    findFloorRoute({ x: 0, z: 6 }, { x: 0, z: -3 }, [
      { minX: -10, maxX: 10, minZ: 0, maxZ: 1 },
    ]),
  ).toBeNull();
});
it("uses the front of rotated shelves as destination", () => {
  expect(shelfApproach({ x: 2, z: 3, rotation: 90 })).toEqual({ x: 3.5, z: 3 });
});
it("rejects invalid and out-of-floor endpoints", () => {
  expect(findFloorRoute({ x: NaN, z: 6 }, { x: 0, z: 0 }, [])).toBeNull();
  expect(findFloorRoute({ x: 20, z: 6 }, { x: 0, z: 0 }, [])).toBeNull();
});
it("uses current table placements and releases space after removal", () => {
  const blocked = (
    x: number,
    z: number,
    obstacles: ReturnType<typeof officeObstacles>,
  ) =>
    obstacles.some(
      (o) => x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ,
    );
  expect(blocked(-6, 3.5, officeObstacles([], []))).toBe(false);
  expect(
    blocked(4, 4, officeObstacles([], [{ x: 4, z: 4, rotation: 0 }])),
  ).toBe(true);
  expect(blocked(4, 4, officeObstacles([], []))).toBe(false);
});

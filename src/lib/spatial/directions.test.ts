import { expect, it } from "vitest";
import {
  OFFICE_ENTRANCE,
  findFloorRoute,
  officeObstacles,
  shelfApproach,
} from "./directions";
import { isKnownLocation, locationHome } from "./verlet-site";

const LOCATIONS = [
  "Cables box", "Camera box", "Field Kit", "Front desk", "Lab A", "Main Store",
  "Main Warehouse", "Office", "Rack 1", "Rack 1 · Level 2", "Robotics Lab",
  "Shelf A", "Shelf B",
];
const inside = (
  p: { x: number; z: number },
  obstacles: ReturnType<typeof officeObstacles>,
) =>
  obstacles.some(
    (o) => p.x >= o.minX && p.x <= o.maxX && p.z >= o.minZ && p.z <= o.maxZ,
  );

it("gives every sample location a home on Verlet's floor", () => {
  for (const name of LOCATIONS) expect(isKnownLocation(name)).toBe(true);
});
it("routes from the door to every location's shelf without crossing anything", () => {
  const shelves = LOCATIONS.map((name, i) => ({
    id: String(i),
    name,
    ...locationHome(name, 0),
    items: [],
  }));
  const obstacles = officeObstacles(shelves);
  for (const shelf of shelves) {
    const route = findFloorRoute(
      OFFICE_ENTRANCE,
      shelfApproach(shelf),
      obstacles,
    );
    expect(route, shelf.name).not.toBeNull();
    for (const p of route!.points) expect(inside(p, obstacles)).toBe(false);
    expect(route!.distance).toBeGreaterThan(0);
  }
});
it("reports a blocked route rather than drawing through furniture", () => {
  expect(
    findFloorRoute(OFFICE_ENTRANCE, { x: 0, z: -3 }, [
      { minX: -18, maxX: 18, minZ: -10.6, maxZ: -10.2 },
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
  // just inside the door, which the layout keeps clear
  expect(inside({ x: -5.5, z: -10.5 }, officeObstacles([], []))).toBe(false);
  expect(
    inside({ x: -5.5, z: -10.5 }, officeObstacles([], [{ x: -5.5, z: -10.5, rotation: 0 }])),
  ).toBe(true);
});
it("walks round the floor's columns and furniture", () => {
  expect(inside({ x: 0, z: 0 }, officeObstacles([], []))).toBe(true);
});

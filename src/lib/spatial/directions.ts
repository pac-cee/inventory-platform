import type { Placement } from "./model";
import {
  DESKS,
  ENTRANCE,
  FLOOR_BOUNDS,
  TABLE_HOMES,
  siteObstacles,
} from "./verlet-site";
export interface FloorPoint {
  x: number;
  z: number;
}
export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface FloorRoute {
  points: FloorPoint[];
  distance: number;
}
/** Just inside the hall's glass double door. */
export const OFFICE_ENTRANCE: FloorPoint = { ...ENTRANCE };
export function shelfApproach(shelf: Placement): FloorPoint {
  const angle = (shelf.rotation * Math.PI) / 180;
  return {
    x: Math.round((shelf.x + Math.sin(angle) * 1.5) * 2) / 2,
    z: Math.round((shelf.z + Math.cos(angle) * 1.5) * 2) / 2,
  };
}
export function officeObstacles(
  shelves: Placement[],
  tables?: Placement[],
  desks?: Placement[],
): Obstacle[] {
  // Desks stand where the floor plan puts them until someone moves theirs.
  const seats = (desks ?? DESKS).map((d) => {
    const rotated = Math.abs(Math.sin((d.rotation * Math.PI) / 180)) > 0.5;
    const x = rotated ? 0.95 : 1.0,
      z = rotated ? 1.0 : 0.95;
    return { minX: d.x - x, maxX: d.x + x, minZ: d.z - z, maxZ: d.z + z };
  });
  // Tables stand on the 5190 benches by default; moved tables go with them.
  const furniture = (tables ?? Object.values(TABLE_HOMES)).map((t) => {
    const rotated = Math.abs(Math.sin((t.rotation * Math.PI) / 180)) > 0.5;
    const x = rotated ? 0.7 : 1.2,
      z = rotated ? 1.2 : 0.7;
    return { minX: t.x - x, maxX: t.x + x, minZ: t.z - z, maxZ: t.z + z };
  });
  return [
    ...furniture,
    ...seats,
    ...siteObstacles(),
    ...shelves.map((s) => {
      const rotated = Math.abs(Math.sin((s.rotation * Math.PI) / 180)) > 0.5;
      const halfX = rotated ? 0.45 : 1.2,
        halfZ = rotated ? 1.2 : 0.45;
      return {
        minX: s.x - halfX,
        maxX: s.x + halfX,
        minZ: s.z - halfZ,
        maxZ: s.z + halfZ,
      };
    }),
  ];
}
/** Half-metre grid with furniture clearance. No route means no invented shortcut. */
export function findFloorRoute(
  start: FloorPoint,
  end: FloorPoint,
  obstacles: Obstacle[],
): FloorRoute | null {
  const valid = (p: FloorPoint) =>
    Number.isFinite(p.x) &&
    Number.isFinite(p.z) &&
    p.x >= FLOOR_BOUNDS.x0 &&
    p.x <= FLOOR_BOUNDS.x1 &&
    p.z >= FLOOR_BOUNDS.z0 &&
    p.z <= FLOOR_BOUNDS.z1;
  if (!valid(start) || !valid(end)) return null;
  const snap = (p: FloorPoint) => ({
    x: Math.round(p.x * 2) / 2,
    z: Math.round(p.z * 2) / 2,
  });
  const a = snap(start),
    b = snap(end);
  const key = (p: FloorPoint) => `${p.x},${p.z}`;
  const blocked = (p: FloorPoint) =>
    !valid(p) ||
    obstacles.some(
      (o) => p.x >= o.minX && p.x <= o.maxX && p.z >= o.minZ && p.z <= o.maxZ,
    );
  if (blocked(a) || blocked(b)) return null;
  const queue = [a],
    previous = new Map<string, FloorPoint | null>([[key(a), null]]);
  for (let index = 0; index < queue.length; index++) {
    const p = queue[index];
    if (key(p) === key(b)) {
      const points: FloorPoint[] = [];
      let cursor: FloorPoint | null = p;
      while (cursor) {
        points.push(cursor);
        cursor = previous.get(key(cursor)) ?? null;
      }
      points.reverse();
      return { points, distance: (points.length - 1) * 0.5 };
    }
    for (const [dx, dz] of [
      [0, -0.5],
      [0.5, 0],
      [0, 0.5],
      [-0.5, 0],
    ]) {
      const next = { x: p.x + dx, z: p.z + dz };
      if (!previous.has(key(next)) && !blocked(next)) {
        previous.set(key(next), p);
        queue.push(next);
      }
    }
  }
  return null;
}

import type { Placement } from "./model";
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
export const OFFICE_ENTRANCE: FloorPoint = { x: 0, z: 6 };
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
): Obstacle[] {
  const fixed: Obstacle[] = [
    { minX: -7.6, maxX: -4.4, minZ: 2.5, maxZ: 5.4 },
    { minX: -4.1, maxX: -0.9, minZ: 2.5, maxZ: 5.4 },
    { minX: 2.7, maxX: 7.3, minZ: 1.7, maxZ: 4.6 },
    { minX: -8.55, maxX: -4.45, minZ: 0.45, maxZ: 1.15 },
    { minX: -4.55, maxX: -0.45, minZ: 0.45, maxZ: 1.15 },
    { minX: -9.4, maxX: -8.2, minZ: 5.1, maxZ: 6.3 },
    { minX: 8.2, maxX: 9.4, minZ: -6.3, maxZ: -5.1 },
    { minX: 8.2, maxX: 9.4, minZ: 5.1, maxZ: 6.3 },
  ];
  const furniture = tables
    ? tables.map((t) => {
        const rotated = Math.abs(Math.sin((t.rotation * Math.PI) / 180)) > 0.5;
        const x = rotated ? 1 : 1.6,
          z = rotated ? 1.6 : 1;
        return { minX: t.x - x, maxX: t.x + x, minZ: t.z - z, maxZ: t.z + z };
      })
    : fixed.slice(0, 3);
  return [
    ...furniture,
    ...fixed.slice(3),
    ...shelves.map((s) => {
      const rotated = Math.abs(Math.sin((s.rotation * Math.PI) / 180)) > 0.5;
      const halfX = rotated ? 0.9 : 1.75,
        halfZ = rotated ? 1.75 : 0.9;
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
    Math.abs(p.x) <= 9 &&
    Math.abs(p.z) <= 6;
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

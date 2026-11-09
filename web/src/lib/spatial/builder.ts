import { clampPlacement, type Placement, type SpatialShelf } from "./model";
export function shelfLevels(requested: number | undefined, boxCount: number) {
  return Math.max(
    Math.ceil(boxCount / 4),
    Math.max(
      1,
      Math.min(6, Math.round(Number.isFinite(requested) ? requested! : 3)),
    ),
  );
}
export function snapShelf(p: Placement): Placement {
  return clampPlacement({
    ...p,
    x: Math.round(p.x * 2) / 2,
    z: Math.round(p.z * 2) / 2,
  });
}
export function emptyShelfCopy(s: SpatialShelf, id: string): SpatialShelf {
  return {
    id,
    ...(s.kind ? { kind: s.kind } : {}),
    name: `${s.name} copy`,
    ...snapShelf({ ...s, x: s.x + 3, z: s.z }),
    levels: shelfLevels(s.levels, 0),
    items: [],
    prototype: true,
  };
}

export const OFFICE_TABLES: SpatialShelf[] = [
  {
    id: "office-table-1",
    name: "Desk 1",
    x: -6,
    z: 3.5,
    rotation: 0,
    kind: "table",
    items: [],
  },
  {
    id: "office-table-2",
    name: "Desk 2",
    x: -2.5,
    z: 3.5,
    rotation: 0,
    kind: "table",
    items: [],
  },
  {
    id: "office-table-3",
    name: "Work table",
    x: 5,
    z: 2.7,
    rotation: 0,
    kind: "table",
    items: [],
  },
];

import { clampPlacement, type Placement, type SpatialShelf } from "./model";
import { TABLE_HOMES } from "./verlet-site";
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

/** The office's tables, standing on the 5190 floor's benches. */
export const OFFICE_TABLES: SpatialShelf[] = [
  ["office-table-1", "Desk 1"],
  ["office-table-2", "Desk 2"],
  ["office-table-3", "Work table"],
].map(([id, name]) => ({
  id,
  name,
  x: TABLE_HOMES[id].x,
  z: TABLE_HOMES[id].z,
  rotation: TABLE_HOMES[id].rotation,
  kind: "table" as const,
  items: [],
}));

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
export function snapShelf(p: Placement, kit?: string | false): Placement {
  return clampPlacement(
    {
      ...p,
      x: Math.round(p.x * 2) / 2,
      z: Math.round(p.z * 2) / 2,
    },
    kit,
  );
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

/** The office's work tables, where the floor plan puts them. */
export function officeTables(): SpatialShelf[] {
  const names: Record<string, string> = {
    "office-table-1": "Table 1",
    "office-table-2": "Table 2",
    "office-table-3": "Work table",
  };
  return Object.entries(TABLE_HOMES).map(([id, home]) => ({
    id,
    name: names[id] ?? "Table",
    ...home,
    kind: "table" as const,
    items: [],
  }));
}

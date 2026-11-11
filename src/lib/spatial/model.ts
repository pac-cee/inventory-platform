import { DESK_BOUNDS, FLOOR_BOUNDS } from "./verlet-site";

export interface Placement {
  x: number;
  z: number;
  rotation: number;
  levels?: number;
}
export interface SpatialItem {
  id: string;
  name: string;
  type: string;
  quantity: number;
  capacity: number;
}
export interface SpatialShelf extends Placement {
  kind?: "shelf" | "table" | "desk";
  /** Desks: who sits there (a person's id) and their name, if anyone. */
  owner?: string | null;
  ownerName?: string | null;
  /** Desks: the signed-in person's own desk. */
  mine?: boolean;
  /** Desks: this person may not move it (not theirs, and not a manager). */
  locked?: boolean;
  boxes?: import("./boxes").StorageBox[];
  id: string;
  name: string;
  items: SpatialItem[];
  prototype?: boolean;
}
export type Layout = Record<string, Placement>;

export function shelfFill(quantity: number, capacity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.min(
    12,
    Math.ceil(quantity),
    Math.max(
      1,
      Math.ceil((quantity / Math.max(quantity, capacity || quantity)) * 12),
    ),
  );
}
/** Shelves hold stock; tables and desks are furniture. */
export const isShelf = (s: { kind?: string }) => !s.kind || s.kind === "shelf";
/** Desk ids carry this prefix, so a saved layout knows which rules apply. */
export const DESK_PREFIX = "desk:";
export const isDeskId = (id: string) => id.startsWith(DESK_PREFIX);

/** Keep a placement on the floor. Desks may also stand in the small offices,
 *  but never in the wall between them and the hall, or in the corridor. */
export function clampPlacement(p: Placement, desk = false): Placement {
  if (desk) {
    const b = DESK_BOUNDS;
    const z = p.z > b.wall ? Math.max(b.hall, Math.min(b.z1, p.z)) : Math.max(b.z0, Math.min(b.rooms, p.z));
    return {
      x: Math.max(b.x0, Math.min(b.x1, p.x)),
      z,
      rotation: (((Math.round(p.rotation / 90) * 90) % 360) + 360) % 360,
    };
  }
  return {
    ...(Number.isFinite(p.levels)
      ? { levels: Math.max(1, Math.min(6, Math.round(p.levels!))) }
      : {}),
    x: Math.max(FLOOR_BOUNDS.x0, Math.min(FLOOR_BOUNDS.x1, p.x)),
    z: Math.max(FLOOR_BOUNDS.z0, Math.min(FLOOR_BOUNDS.z1, p.z)),
    rotation: (((Math.round(p.rotation / 90) * 90) % 360) + 360) % 360,
  };
}
export function readLayout(raw: string | null): Layout {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([, p]) =>
            p &&
            typeof p === "object" &&
            [p.x, p.z, p.rotation].every(
              (n) => typeof n === "number" && Number.isFinite(n),
            ),
        )
        .map(([id, p]) => [id, clampPlacement(p, isDeskId(id))]),
    );
  } catch {
    return {};
  }
}

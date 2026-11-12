import { FLOOR_BOUNDS, clampPiece } from "./verlet-site";

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
  kind?: "shelf" | "table" | "desk" | "piece";
  /** Desks and furniture: which piece of the furniture kit it is. */
  kit?: string;
  /** Desks: who sits there (a person's id) and their name, if anyone. */
  owner?: string | null;
  ownerName?: string | null;
  /** Desks: the signed-in person's own desk. */
  mine?: boolean;
  /** Desks and furniture: this person may not move it. */
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
/** Shelves hold stock; tables, desks and other furniture do not. */
export const isShelf = (s: { kind?: string }) => !s.kind || s.kind === "shelf";
/** Desks and furniture are pieces of the floor plan. */
export const isFurniture = (s: { kind?: string }) => s.kind === "desk" || s.kind === "piece";
/** Ids of plan furniture carry a prefix, so a saved layout knows what they are. */
export const DESK_PREFIX = "desk:";
export const PIECE_PREFIX = "piece:";
export const isDeskId = (id: string) => id.startsWith(DESK_PREFIX);
export const isPieceId = (id: string) => id.startsWith(PIECE_PREFIX);
/** The plan's id for a desk or piece of furniture on the map. */
export const planId = (id: string) => id.slice(id.indexOf(":") + 1);

const quarterTurn = (rotation: number) => (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
/** Keep a placement on the floor. Furniture (give its kit kind) keeps its
 *  whole footprint inside the walls and may also stand in the small offices. */
export function clampPlacement(p: Placement, kit?: string | false): Placement {
  if (kit) {
    const rotation = quarterTurn(p.rotation);
    const at = clampPiece({ x: p.x, z: p.z }, kit, (rotation * Math.PI) / 180);
    return { x: at.x, z: at.z, rotation };
  }
  return {
    ...(Number.isFinite(p.levels)
      ? { levels: Math.max(1, Math.min(6, Math.round(p.levels!))) }
      : {}),
    x: Math.max(FLOOR_BOUNDS.x0, Math.min(FLOOR_BOUNDS.x1, p.x)),
    z: Math.max(FLOOR_BOUNDS.z0, Math.min(FLOOR_BOUNDS.z1, p.z)),
    rotation: quarterTurn(p.rotation),
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
        // Furniture is saved with the plan, never in a device's layout.
        .filter(([id]) => !isDeskId(id) && !isPieceId(id))
        .map(([id, p]) => [id, clampPlacement(p)]),
    );
  } catch {
    return {};
  }
}

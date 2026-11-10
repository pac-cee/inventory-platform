import { FLOOR_BOUNDS } from "./verlet-site";

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
  kind?: "shelf" | "table";
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
export function clampPlacement(p: Placement): Placement {
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
        .map(([id, p]) => [id, clampPlacement(p)]),
    );
  } catch {
    return {};
  }
}

import type { Location } from "@/lib/api/types";

/**
 * Leaf locations — the only places stock actually lives. A leaf is a location
 * that is nobody's parent: either a top-level location with no sub-locations,
 * or a sub-location. Top-level locations that HAVE sub-locations are excluded,
 * because items are stocked in the sub-locations, not the parent.
 */
export function leafLocations(all: Location[]): Location[] {
  const parentIds = new Set(all.filter((l) => l.parent_id).map((l) => l.parent_id));
  return all.filter((l) => !parentIds.has(l.id));
}

/**
 * Everywhere stock can be put: the leaves, PLUS any location that already holds
 * stock directly.
 *
 * A room can have sub-locations AND items sitting in the room itself — the
 * location page shows those under "Items directly here". Leaf-only pickers made
 * such a room unreachable, so its stock could be seen but never taken, returned
 * or added to. Passing the ids of locations that hold something brings them
 * back into the list.
 */
export function stockableLocations(all: Location[], stockedIds: Iterable<string>): Location[] {
  const parentIds = new Set(all.filter((l) => l.parent_id).map((l) => l.parent_id));
  const stocked = new Set(stockedIds);
  return all.filter((l) => !parentIds.has(l.id) || stocked.has(l.id));
}

/**
 * Full path label, e.g. "Room A › Cupboard 1 › Level 3", so identically-named
 * (sub-)locations at any depth are distinguishable. Top-level renders as name.
 */
export function locationLabel(loc: Location, all: Location[]): string {
  const byId = new Map(all.map((l) => [l.id, l]));
  const parts: string[] = [];
  let cur: Location | undefined = loc;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join(" › ");
}

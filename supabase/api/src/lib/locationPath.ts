import { rows } from "../db.js";

/**
 * Full location paths, e.g. "Main Warehouse › Rack B › Level 5".
 *
 * Locations nest to any depth, so a leaf name on its own is ambiguous — "Level
 * 5" says nothing about which shelf in which room. The activity report has
 * always printed the whole path; this is that logic, lifted out of
 * routes/movements.ts so every screen that names a location can agree.
 *
 * One query for the whole table (a few dozen rows) and a map, rather than a
 * recursive CTE per row: the tree is small, every caller needs many rows at
 * once, and this keeps the SQL in each route unchanged.
 */

/** The separator between levels. Matches what the activity report has used. */
const SEP = " › ";

export interface LocationPathLookup {
  /** The full path for a location id, or "" when the id is unknown. */
  (id: string | null | undefined): string;
}

/**
 * Build a lookup over every location.
 *
 * Walks parents defensively: a cycle in `parent_id` would otherwise loop
 * forever, so each id is visited at most once per path.
 */
export async function loadLocationPaths(): Promise<LocationPathLookup> {
  const locs = await rows<{ id: string; name: string; parent_id: string | null }>(
    "select id, name, parent_id from locations",
  );
  const byId = new Map(locs.map((l) => [l.id, l]));
  const cache = new Map<string, string>();

  return (id) => {
    if (!id) return "";
    const hit = cache.get(id);
    if (hit !== undefined) return hit;

    const parts: string[] = [];
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    const path = parts.join(SEP);
    cache.set(id, path);
    return path;
  };
}

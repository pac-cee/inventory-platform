// The planning part of normalize-location-kinds.mjs, kept pure (no database) so it can be tested.
//
// Layout: Area > Shelf > Level > Box. A "grouping" is a place that only collects shelves, such as
// "Shelves" inside "Hardware Area": it is stored as an area and does NOT count as a step, so the
// shelves inside it are still shelves and their levels still levels.

const EXPECTED = ["area", "shelf", "level"]; // by step 0, 1, 2

/**
 * rows: [{ id, name, kind, parent_id }]. groupings: names (any case) of grouping places; only
 * honoured directly inside a top-level area. Returns the tree lines, the planned changes
 * ({ id, name, from, to }) and the places left for a person ({ path, why }).
 */
export function planKindFixes(rows, { groupings = [] } = {}) {
  const group = new Set(groupings.map((g) => g.trim().toLowerCase()).filter(Boolean));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kids = new Map();
  for (const r of rows) {
    const key = byId.has(r.parent_id) ? r.parent_id : null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(r);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const plan = [];
  const manual = [];
  const lines = [];

  // `step` = which layer this place should be (0 area, 1 shelf, 2 level, 3+ box); `indent` = how far to print.
  const walk = (parentId, step, indent, trail, parentPath) => {
    for (const r of kids.get(parentId) ?? []) {
      if (trail.has(r.id)) continue; // a loop in bad data
      const path = parentPath ? `${parentPath} > ${r.name}` : r.name;
      const isGrouping = step === 1 && group.has(r.name.trim().toLowerCase());
      const want = isGrouping ? "area" : (EXPECTED[step] ?? null);
      let note = "";
      if (r.kind === "box") {
        if (step < 3) {
          note = "  <- a box this high up: it should sit on a level";
          manual.push({ path, why: `a box at step ${step}: it needs to be on a level` });
        }
      } else if (want === null) {
        note = "  <- needs a person: should be a box";
        manual.push({ path, why: "below a level, so it should be a box (a box's QR code is made in the app)" });
      } else if (r.kind !== want) {
        note = `  -> ${want}`;
        plan.push({ id: r.id, name: r.name, path, from: r.kind, to: want });
      }
      lines.push(`${"    ".repeat(indent)}${r.name}  [${r.kind}]${isGrouping ? " (grouping)" : ""}${note}`);
      walk(r.id, isGrouping ? 1 : step + 1, indent + 1, new Set([...trail, r.id]), path);
    }
  };
  walk(null, 0, 0, new Set(), "");
  return { lines, plan, manual };
}

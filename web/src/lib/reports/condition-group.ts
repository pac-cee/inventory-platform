import type { ConditionRow } from "@/lib/api/types";

/**
 * One printed line: every variant of a product at a location, added up.
 *
 * Two entries differing only by specification are the same thing to whoever
 * reads the report — "15 Latitude 5420" — but they stay separate rows in the
 * database so each keeps its own faults and its own % operational. Grouping
 * happens here, at the point of display, rather than by merging the data.
 */
export type GroupedRow = {
  key: string;
  room_id: string;
  room_name: string;
  location_name: string;
  category: string | null;
  /** What kind of thing this is — the line's heading. */
  type: string;
  name: string;
  model: string;
  /** Every SKU folded into this line. */
  skus: string[];
  /** Each variant and what it contributes. */
  variants: { specification: string | null; total: number }[];
  total: number;
  operational: number;
  damaged: number;
  accounted: number;
  in_use: number;
  faults: ConditionRow["faults"];
  /** Open suggestions across the variants on this line. */
  suggestions: ConditionRow["suggestions"];
  /** Where these units actually are, with how many at each. */
  locations: { name: string; total: number }[];
  /** The rows behind this line, if you need to drill in. */
  rows: ConditionRow[];
};

/**
 * How lines are formed.
 *
 * `item`     — one line per product per category, across every location. The
 *              report is then about what you own, and place is a detail.
 * `location` — one line per product per place, which is what the printed
 *              room-by-room sheet needs.
 */
export type GroupMode = "item" | "location";

/**
 * What makes two rows the same printed line.
 *
 * Identity is (type, name, model) — the same rule the catalog enforces — so two
 * different items never have their counts added together. Entries differing
 * only by specification DO combine: that is the variant case.
 *
 * The SKU is deliberately NOT in the key. It is unique per item now, so
 * including it would make every row its own line and defeat the grouping.
 */
function groupKey(r: ConditionRow, mode: GroupMode): string {
  const identity = [
    r.type.trim().toLowerCase(),
    r.name.trim().toLowerCase(),
    r.model.trim().toLowerCase(),
  ].join("~");
  return mode === "item"
    ? [r.category ?? "", identity].join("|")
    : [r.room_id, r.location_id, r.category ?? "", identity].join("|");
}

/** Add a location's contribution, merging repeats of the same place. */
function addLocation(into: { name: string; total: number }[], name: string, total: number): void {
  const found = into.find((l) => l.name === name);
  if (found) found.total += total;
  else into.push({ name, total });
}

/**
 * Add a variant, merging repeats of the same specification.
 *
 * One item stocked in five places arrives as five rows carrying the same
 * specification. Pushing each would print that specification five times.
 */
function addVariant(
  into: { specification: string | null; total: number }[],
  specification: string | null,
  total: number,
): void {
  const key = (specification ?? "").trim().toLowerCase();
  const found = into.find((v) => (v.specification ?? "").trim().toLowerCase() === key);
  if (found) found.total += total;
  else into.push({ specification, total });
}

/** Collapse rows into lines under the chosen mode, preserving API ordering. */
export function groupVariants(rows: ConditionRow[], mode: GroupMode): GroupedRow[] {
  const out = new Map<string, GroupedRow>();
  for (const r of rows) {
    const key = groupKey(r, mode);
    const g = out.get(key);
    if (!g) {
      out.set(key, {
        key,
        room_id: r.room_id,
        room_name: r.room_name,
        location_name: r.location_name,
        category: r.category,
        type: r.type,
        name: r.name,
        model: r.model,
        skus: r.sku ? [r.sku] : [],
        variants: [{ specification: r.specification, total: r.total }],
        // NOTE: both lists are deduped as rows are merged below.
        total: r.total,
        operational: r.operational,
        damaged: r.damaged,
        accounted: r.accounted,
        in_use: r.in_use,
        faults: [...r.faults],
        suggestions: [...(r.suggestions ?? [])],
        locations: [{ name: r.location_name, total: r.total }],
        rows: [r],
      });
      continue;
    }
    // The same item in five places is five rows with one SKU and one spec.
    if (r.sku && !g.skus.includes(r.sku)) g.skus.push(r.sku);
    addVariant(g.variants, r.specification, r.total);
    g.total += r.total;
    g.operational += r.operational;
    g.damaged += r.damaged;
    g.accounted += r.accounted;
    g.in_use += r.in_use;
    g.faults.push(...r.faults);
    g.suggestions.push(...(r.suggestions ?? []));
    addLocation(g.locations, r.location_name, r.total);
    g.rows.push(r);
  }
  return [...out.values()];
}

/** The lone spec, or each variant with its share when there are several. */
export function variantsText(g: GroupedRow): string {
  if (g.variants.length === 1) return g.variants[0].specification?.trim() || "—";
  return g.variants
    .map((v) => `${v.specification?.trim() || "unspecified"} (${v.total})`)
    .join(", ");
}

/** Condition sentence for a grouped line — same shape as the per-row one. */
export function groupConditionText(g: GroupedRow): string {
  const parts: string[] = [];
  if (g.damaged === 0) return "Good";
  if (g.operational > 0) parts.push(`${g.operational} good`);
  for (const f of g.faults) parts.push(`${f.units} ${f.note}`);
  const unexplained = g.damaged - g.accounted;
  if (unexplained > 0) parts.push(`${unexplained} out of service (reason not recorded)`);
  return parts.join(", ");
}

/**
 * What to do about this line: the fixes recorded against its faults, then any
 * open suggestions. Suggestions are marked so a reader can tell "this is
 * broken" from "this could be better".
 */
export function groupRecommendationText(g: GroupedRow): string {
  const seen = new Set<string>();
  for (const f of g.faults) if (f.recommendation) seen.add(f.recommendation);
  for (const x of g.suggestions ?? []) seen.add(`${x.note} (suggested)`);
  return [...seen].join("; ");
}

/** Operational share across the whole line. */
export function groupPercent(g: GroupedRow): number {
  if (g.total <= 0) return 0;
  return Math.round((g.operational / g.total) * 1000) / 10;
}

/** "Storeroom (5), Lab A (3)" — or the single place when there is only one. */
export function locationsText(g: GroupedRow): string {
  if (g.locations.length === 1) return g.locations[0].name;
  return g.locations.map((l) => `${l.name} (${l.total})`).join(", ");
}

/**
 * Lines sharing a name, so the name can be written once with its SKUs beneath.
 *
 * The lines keep their own totals — this only controls how they are laid out.
 * A name with a single line renders flat, without a redundant heading.
 */
export type NameGroup = {
  key: string;
  name: string;
  category: string | null;
  lines: GroupedRow[];
  /** Combined across the lines, for the name's summary row. */
  total: number;
  operational: number;
};

export function nestByName(lines: GroupedRow[]): NameGroup[] {
  const out = new Map<string, NameGroup>();
  for (const l of lines) {
    // Nested by TYPE: "Cable" is the heading, its names are the lines under it.
    const key = [l.category ?? "", l.type.trim().toLowerCase()].join("|");
    const g = out.get(key);
    if (!g) {
      out.set(key, {
        key,
        name: l.type,
        category: l.category,
        lines: [l],
        total: l.total,
        operational: l.operational,
      });
      continue;
    }
    g.lines.push(l);
    g.total += l.total;
    g.operational += l.operational;
  }
  return [...out.values()];
}

/** Operational share for a whole name, across its SKUs. */
export function namePercent(g: NameGroup): number {
  if (g.total <= 0) return 0;
  return Math.round((g.operational / g.total) * 1000) / 10;
}

/** The SKU for a line, or a marker when the entry has none. */
export function skuText(g: GroupedRow): string {
  return g.skus.length ? g.skus.join(", ") : "No SKU";
}

/** How a line identifies itself under its type heading: name and model. */
export function itemText(g: GroupedRow): string {
  return g.model && g.model !== "Unspecified" ? `${g.name} · ${g.model}` : g.name;
}

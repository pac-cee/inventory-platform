import type { Item } from "@/lib/api/types";

type ItemMode = Pick<Item, "package_label" | "units_per_container">;

function plural(word: string, n: number): string {
  return `${word}${n === 1 ? "" : "s"}`;
}

/** Whole number as int, otherwise one decimal (e.g. 2, 1.5). */
export function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** True if the item is counted in whole packages (contents not tracked). */
export function isPackaged(item: ItemMode): boolean {
  return !!item.package_label;
}

/**
 * How to read a raw quantity for an item, respecting its mode:
 * - package item    → "5 packages"           (quantity IS the package count)
 * - container item  → "2 boxes (24 units)"   (needs a per-location container label)
 * - loose units     → "5" (or "5 accessible" via `noun`)
 */
export function formatQuantity(
  item: ItemMode,
  quantity: number,
  opts?: { containerLabel?: string | null; noun?: string },
): string {
  if (item.package_label) {
    return `${quantity} ${plural(item.package_label, quantity)}`;
  }
  const cl = opts?.containerLabel;
  if (cl && item.units_per_container > 1) {
    const containers = quantity / item.units_per_container;
    return `${trimNum(containers)} ${plural(cl, containers)} (${quantity} units)`;
  }
  return opts?.noun ? `${quantity} ${opts.noun}` : String(quantity);
}

/** A short unit noun for an item ("packages", "units"), for column headers etc. */
export function unitNoun(item: ItemMode, n = 2): string {
  return item.package_label ? plural(item.package_label, n) : "units";
}

import type { StockLevel } from "@/lib/api/types";

/**
 * An item is flagged "low" once it's depleted to this fraction of the amount it
 * was stocked with (its capacity). A freshly stocked item — quantity at full
 * capacity — is therefore always "ok", never "low".
 */
export const LOW_STOCK_RATIO = 0.25;

/** Sum quantities per item_id across all locations. */
export function totalsByItem(stock: StockLevel[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of stock) {
    totals.set(row.item_id, (totals.get(row.item_id) ?? 0) + row.quantity);
  }
  return totals;
}

/** Sum capacities per item_id across all locations (the item's total ceiling). */
export function capacityByItem(stock: StockLevel[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of stock) {
    totals.set(row.item_id, (totals.get(row.item_id) ?? 0) + (row.capacity ?? 0));
  }
  return totals;
}

/** Sum quantities per location_id across all items. */
export function totalsByLocation(stock: StockLevel[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of stock) {
    totals.set(row.location_id, (totals.get(row.location_id) ?? 0) + row.quantity);
  }
  return totals;
}

/** Count distinct locations an item has stock in. */
export function locationCountByItem(stock: StockLevel[]): Map<string, number> {
  const counts = new Map<string, Set<string>>();
  for (const row of stock) {
    if (row.quantity <= 0) continue;
    const set = counts.get(row.item_id) ?? new Set<string>();
    set.add(row.location_id);
    counts.set(row.item_id, set);
  }
  return new Map([...counts].map(([id, set]) => [id, set.size]));
}

export type StockStatus = "out" | "low" | "ok";

/**
 * Stock status relative to the item's capacity (the amount it was stocked with),
 * which is the maximum — not a minimum. "out" at zero; "ok" at or near full;
 * "low" only once depleted to LOW_STOCK_RATIO of capacity. When capacity is
 * unknown, falls back to treating the current quantity as full (so it's "ok").
 */
export function statusFor(quantity: number, capacity?: number): StockStatus {
  if (quantity <= 0) return "out";
  const cap = capacity && capacity > 0 ? capacity : quantity;
  if (quantity >= cap) return "ok";
  const lowAt = Math.max(1, Math.floor(cap * LOW_STOCK_RATIO));
  return quantity <= lowAt ? "low" : "ok";
}

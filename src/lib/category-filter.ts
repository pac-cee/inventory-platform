import type { Item } from "@/lib/api/types";

/** The value in the address for "items with no category". Never a real category name. */
export const UNCATEGORIZED = "__none";

/** The category an item belongs to, as the filter sees it (blank counts as none). */
export function categoryOf(item: Pick<Item, "category">): string | null {
  const c = item.category?.trim();
  return c ? c : null;
}

/** Items in `category` (exact name), or the ones with no category for UNCATEGORIZED; all when empty. */
export function filterByCategory<T extends Pick<Item, "category">>(items: T[], category: string | undefined): T[] {
  if (!category) return items;
  if (category === UNCATEGORIZED) return items.filter((i) => categoryOf(i) === null);
  return items.filter((i) => categoryOf(i) === category);
}

/** How many items have no category (the count next to "Uncategorized"). */
export function uncategorizedCount(items: Pick<Item, "category">[]): number {
  return items.filter((i) => categoryOf(i) === null).length;
}

/** The catalog link for a category, keeping the search; jumps to the catalog table. */
export function categoryHref(category: string | null, query?: string): string {
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (category) p.set("category", category);
  const qs = p.toString();
  return `/items${qs ? `?${qs}` : ""}#catalog`;
}

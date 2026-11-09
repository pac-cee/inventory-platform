/**
 * Paging a list that is already fully in hand.
 *
 * The catalog is fetched whole (see lib/api/items.ts) because several screens
 * need every item — the location page looks up thumbnails by id, and search
 * runs over the list rather than the visible page. Showing all of it at once
 * would be a wall of rows, so the table pages through it here.
 */

/** Rows per page. 50 is what the catalog screens showed before paging existed. */
export const PAGE_SIZE = 50;

/** How many pages a list of this length needs. Always at least 1, so an empty
 *  list is "page 1 of 1" rather than "page 1 of 0". */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  if (size <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

/** A page number forced into range — a hand-typed ?page=99 lands on the last. */
export function clampPage(page: unknown, total: number, size: number = PAGE_SIZE): number {
  const n = Math.floor(Number(page));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, pageCount(total, size));
}

/** The slice of `list` shown on `page`, which is clamped first. */
export function pageOf<T>(list: T[], page: unknown, size: number = PAGE_SIZE): T[] {
  const p = clampPage(page, list.length, size);
  return list.slice((p - 1) * size, p * size);
}

/** "51–100 of 106" — the numbers for it, 1-based and inclusive. */
export function pageRange(
  page: unknown,
  total: number,
  size: number = PAGE_SIZE,
): { from: number; to: number; page: number; pages: number } {
  const p = clampPage(page, total, size);
  const from = total === 0 ? 0 : (p - 1) * size + 1;
  return { from, to: Math.min(p * size, total), page: p, pages: pageCount(total, size) };
}

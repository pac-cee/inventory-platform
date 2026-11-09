/**
 * Which cached pages an item's data appears on.
 *
 * The catalog lists are fetched with `revalidate: 60`, so after an item changes
 * they keep serving the previous render until something clears them. Every page
 * that shows the item has to be named here or it silently lags — the symptom
 * being a photo that is visible on the item's own page (uncached) but missing
 * from the lists.
 *
 * Kept out of the "use server" action files, which may only export async
 * functions, so it can be unit-tested directly.
 */

/** Every cached route that renders an item. `/items` lists them all, so it
 *  belongs here even though the edit happened on the detail page. */
export function itemPages(itemId: string): string[] {
  return [
    `/items/${itemId}`, // the item's own page
    "/items", // the catalog list — thumbnails and identity
    "/", // the dashboard table
    "/locations", // location cards count and name items
  ];
}

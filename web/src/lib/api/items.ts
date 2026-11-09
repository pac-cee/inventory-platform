import type { Item } from "./types";

/**
 * The whole item catalog, however many pages that takes.
 *
 * GET /items caps a response at 200 rows and defaults to 50, so a single call
 * silently truncated the catalog — items past the cap vanished from the lists,
 * and on the location page they kept their row but lost their thumbnail,
 * because the id → item map used for photos never held them.
 */

/** Rows per request — the largest `limit` the API accepts. */
const BATCH = 200;

/** A ceiling on requests, so a server that ignored `offset` cannot spin here. */
const MAX_BATCHES = 50;

/** Just the part of the API client this needs, so a test can pass a stub. */
export interface ItemGetter {
  get<T>(path: string, opts?: { revalidate?: number }): Promise<T>;
}

/** Fetch every item, one full batch at a time until a short batch ends it. */
export async function fetchAllItems(
  api: ItemGetter,
  opts?: { revalidate?: number },
): Promise<Item[]> {
  const all: Item[] = [];
  for (let n = 0; n < MAX_BATCHES; n++) {
    const batch = await api.get<Item[]>(`/items?limit=${BATCH}&offset=${all.length}`, opts);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    // A short batch means the catalog ran out; a full one might not have.
    if (batch.length < BATCH) break;
  }
  return all;
}

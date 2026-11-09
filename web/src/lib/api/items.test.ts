import { describe, it, expect, vi } from "vitest";
import { fetchAllItems } from "./items";
import type { Item } from "./types";

/**
 * The catalog is fetched whole. These pin the loop that does it, because the
 * bug it fixes was invisible: one call returned 50 rows and every screen
 * treated that as the entire catalog.
 */

const item = (n: number): Item => ({ id: `i${n}`, name: `Item ${n}` }) as Item;

/** A stub API holding `total` items, answering ?limit=&offset= like the real one. */
function stub(total: number) {
  const calls: string[] = [];
  const api = {
    get: async <T>(path: string): Promise<T> => {
      calls.push(path);
      const url = new URL(path, "http://x");
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset"));
      return Array.from({ length: total }, (_, i) => item(i + 1)).slice(
        offset,
        offset + limit,
      ) as T;
    },
  };
  return { api, calls };
}

describe("fetchAllItems", () => {
  it("returns a catalog smaller than one batch in a single request", async () => {
    const { api, calls } = stub(106);
    const items = await fetchAllItems(api);
    expect(items).toHaveLength(106);
    expect(calls).toHaveLength(1);
  });

  it("keeps going past the 200-row cap", async () => {
    const { api, calls } = stub(450);
    const items = await fetchAllItems(api);
    expect(items).toHaveLength(450);
    expect(calls).toEqual([
      "/items?limit=200&offset=0",
      "/items?limit=200&offset=200",
      "/items?limit=200&offset=400",
    ]);
  });

  it("asks for one more batch when the catalog is an exact multiple", async () => {
    // 400 items means the second batch is full, so the loop cannot know it is
    // done without a third request that comes back empty.
    const { api, calls } = stub(400);
    const items = await fetchAllItems(api);
    expect(items).toHaveLength(400);
    expect(calls).toHaveLength(3);
  });

  it("returns items in order, with nothing dropped or duplicated", async () => {
    const { api } = stub(305);
    const items = await fetchAllItems(api);
    expect(items.map((i) => i.id)).toEqual(
      Array.from({ length: 305 }, (_, i) => `i${i + 1}`),
    );
  });

  it("handles an empty catalog without a second request", async () => {
    const { api, calls } = stub(0);
    expect(await fetchAllItems(api)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("stops instead of looping when the API ignores offset", async () => {
    // A server that always returns a full batch would page forever; the batch
    // ceiling is what stops it.
    const get = vi.fn(async () => Array.from({ length: 200 }, (_, i) => item(i)));
    await fetchAllItems({ get: get as never });
    expect(get.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("passes the cache setting through to every request", async () => {
    const get = vi.fn(async () => [] as Item[]);
    await fetchAllItems({ get: get as never }, { revalidate: 60 });
    expect(get).toHaveBeenCalledWith("/items?limit=200&offset=0", { revalidate: 60 });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { createItem, itemPayload } from "../helpers/items.js";

/**
 * Paging GET /items.
 *
 * The list has always defaulted to 50 rows, and every client asked for it with
 * no `limit` — so a catalog larger than 50 was silently cut off: the extra
 * items vanished from the lists, and on the location screen they kept their row
 * but lost their thumbnail, because the id -> item map never held them. The
 * clients now page through with limit + offset; these pin the endpoint that
 * loop depends on.
 */

const TOTAL = 60;
const PREFIX = `__paging__ ${Date.now()}`;

let adminH: Record<string, string>;
const created: string[] = [];

beforeAll(async () => {
  adminH = await authHeaders("admin");
  for (let i = 0; i < TOTAL; i++) {
    const n = String(i).padStart(3, "0");
    created.push(
      await createItem(adminH, {
        ...itemPayload(),
        type: `${PREFIX} ${n}`,
        name: `${PREFIX} name ${n}`,
        model: `${PREFIX} model ${n}`,
      }),
    );
  }
}, 120_000);

afterAll(async () => {
  for (const id of created) await app.delete(`/items/${id}`).set(adminH);
});

/** Our items only — the catalog holds whatever other suites left behind. */
const mine = (body: { type: string }[]) => body.filter((i) => i.type.startsWith(PREFIX));

describe("GET /items paging", () => {
  it("still returns 50 by default — the cap the clients used to hit", async () => {
    const res = await app.get("/items").set(adminH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it("returns everything when the caller pages through it", async () => {
    const all: { id: string; type: string }[] = [];
    for (let n = 0; n < 50; n++) {
      const res = await app.get(`/items?limit=200&offset=${all.length}`).set(adminH);
      expect(res.status).toBe(200);
      if (res.body.length === 0) break;
      all.push(...res.body);
      if (res.body.length < 200) break;
    }
    expect(mine(all)).toHaveLength(TOTAL);
  });

  it("gives consecutive pages different rows, with none repeated", async () => {
    const first = await app.get("/items?limit=25&offset=0").set(adminH);
    const second = await app.get("/items?limit=25&offset=25").set(adminH);
    expect(first.body).toHaveLength(25);
    expect(second.body).toHaveLength(25);
    const ids = new Set([...first.body, ...second.body].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(50);
  });

  it("answers an offset past the end with an empty list, ending the loop", async () => {
    const res = await app.get("/items?limit=50&offset=100000").set(adminH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("caps limit at 200 rather than accepting any number", async () => {
    // Rejected by validation, so a client cannot ask for the whole table at
    // once — which is why the loop pages instead of raising the ceiling.
    const res = await app.get("/items?limit=5000").set(adminH);
    expect(res.status).toBe(422);
  });

  it("pages a search too, so a match past the first page is still found", async () => {
    const page1 = await app.get(`/items?search=${encodeURIComponent(PREFIX)}&limit=50&offset=0`).set(adminH);
    const page2 = await app.get(`/items?search=${encodeURIComponent(PREFIX)}&limit=50&offset=50`).set(adminH);
    expect(page1.body).toHaveLength(50);
    expect(page2.body).toHaveLength(TOTAL - 50);
  });

  it("carries has_photo on every page, so a thumbnail survives paging", async () => {
    const res = await app.get("/items?limit=200&offset=0").set(adminH);
    for (const item of res.body as { has_photo: unknown }[]) {
      expect(typeof item.has_photo).toBe("boolean");
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

// GET /items/where — "do we have it, and which box is it in?"
describe("items where", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  const stamp = Date.now();
  const itemIds: string[] = [];
  const locIds: string[] = [];

  const makeLoc = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await app.post("/locations").set(adminH).send({ name: `${name}-${stamp}`, ...extra });
    locIds.push(r.body.id);
    return r.body.id as string;
  };
  const makeItem = async (n: string) => {
    const r = await app.post("/items").set(adminH).send({ type: `${n}-${stamp}`, name: `${n}-${stamp}`, model: "Unspecified" });
    itemIds.push(r.body.id);
    return r.body.id as string;
  };
  const stock = (itemId: string, locationId: string, qty: number) =>
    app.post("/movements").set(adminH).send({ item_id: itemId, location_id: locationId, delta: qty, capacity_delta: qty, reason: "initial" });

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
  });
  afterAll(async () => {
    for (const id of itemIds) await app.delete(`/items/${id}`).set(adminH).catch(() => {});
    for (const id of [...locIds].reverse()) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
  });

  it("totals what is on the shelf and names the places by full path, most units first", async () => {
    const room = await makeLoc("wh-room");
    const shelf = (await app.post("/locations").set(adminH).send({ name: `wh-shelf-${stamp}`, parent_id: room, kind: "shelf" })).body.id as string;
    locIds.push(shelf);
    const level = (await app.post("/locations").set(adminH).send({ name: `wh-level-${stamp}`, parent_id: shelf, kind: "level" })).body.id as string;
    locIds.push(level);
    const box = (await app.post("/locations").set(adminH).send({ name: `wh-box-${stamp}`, parent_id: level, kind: "box", label: "USB-A to C cables" })).body.id as string;
    locIds.push(box);
    const pi = await makeItem("wh-pi");
    await stock(pi, box, 5);
    await stock(pi, shelf, 2);

    const res = await app.get(`/items/where?ids=${pi}`).set(memberH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].item_id).toBe(pi);
    expect(res.body[0].total).toBe(7);
    expect(res.body[0].places.map((p: any) => p.quantity)).toEqual([5, 2]);
    expect(res.body[0].places[0]).toMatchObject({
      location_id: box,
      kind: "box",
      label: "USB-A to C cables",
      path: `wh-room-${stamp} › wh-shelf-${stamp} › wh-level-${stamp} › wh-box-${stamp}`,
    });
  });

  it("keeps only the top three places", async () => {
    const item = await makeItem("wh-many");
    for (const [i, q] of [[1, 9], [2, 7], [3, 5], [4, 3]] as const) await stock(item, await makeLoc(`wh-spot${i}`), q);
    const res = await app.get(`/items/where?ids=${item}`).set(memberH);
    expect(res.body[0].total).toBe(24);
    expect(res.body[0].places.map((p: any) => p.quantity)).toEqual([9, 7, 5]);
  });

  it("answers for several items in the order asked, and an item with no stock is a clear zero", async () => {
    const a = await makeItem("wh-a");
    const b = await makeItem("wh-b");
    await stock(a, await makeLoc("wh-where-a"), 3);
    const res = await app.get(`/items/where?ids=${b},${a}`).set(memberH);
    expect(res.body.map((r: any) => r.item_id)).toEqual([b, a]);
    expect(res.body[0]).toEqual({ item_id: b, total: 0, places: [] });
    expect(res.body[1].total).toBe(3);
  });

  it("does not count units that have all been taken out", async () => {
    const item = await makeItem("wh-gone");
    const loc = await makeLoc("wh-gone-loc");
    await stock(item, loc, 2);
    await app.post("/movements/check-out").set(memberH).send({ item_id: item, location_id: loc, quantity: 2 });
    const res = await app.get(`/items/where?ids=${item}`).set(memberH);
    expect(res.body[0]).toEqual({ item_id: item, total: 0, places: [] });
  });

  it("rejects ids that are not ids, and needs a signed-in user", async () => {
    expect((await app.get("/items/where?ids=nope").set(memberH)).status).toBe(422);
    expect((await app.get("/items/where").set(memberH)).status).toBe(422);
    expect((await app.get("/items/where?ids=00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import type { Response } from "supertest";

/**
 * Per-location item numbers (0036).
 *
 * Each (item, location) pair gets a small integer so people can say "number 3
 * on that shelf". Numbering is per location and assigned by a trigger, so the
 * things worth pinning down are: it starts at 1 in a fresh location, it counts
 * up, it restarts elsewhere, and it does not move when stock changes.
 */
describe("per-location item numbers", () => {
  let adminH: Record<string, string>;
  const stamp = Date.now();
  const itemIds: string[] = [];
  let roomA: string;
  let roomB: string;

  /** Put stock somewhere — the only way an item_stock row is ever created. */
  const stockUp = (itemId: string, locationId: string, qty: number): Promise<Response> =>
    app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: locationId, delta: qty, capacity_delta: qty, reason: "initial" });

  const slotOf = async (itemId: string, locationId: string): Promise<number | null> => {
    const res = await app.get(`/stock?item_id=${itemId}&location_id=${locationId}`).set(adminH);
    expect(res.status).toBe(200);
    return res.body[0]?.slot_no ?? null;
  };

  beforeAll(async () => {
    adminH = await authHeaders("admin");

    const a = await app.post("/locations").set(adminH).send({ name: `slot-a-${stamp}` });
    const b = await app.post("/locations").set(adminH).send({ name: `slot-b-${stamp}` });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    roomA = a.body.id;
    roomB = b.body.id;

    for (const n of [1, 2, 3]) {
      const res = await app
        .post("/items")
        .set(adminH)
        .send({ type: `slot-item-${stamp}-${n}`, name: `SLOT-${stamp}-${n}`, model: "Std" });
      expect(res.status).toBe(201);
      itemIds.push(res.body.id);
    }
  });

  afterAll(async () => {
    for (const id of itemIds) await app.delete(`/items/${id}`).set(adminH).catch(() => {});
    for (const id of [roomA, roomB]) {
      if (id) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
    }
  });

  it("numbers items 1, 2, 3 in the order they arrive in a location", async () => {
    for (const id of itemIds) expect((await stockUp(id, roomA, 10)).status).toBe(201);
    expect(await slotOf(itemIds[0], roomA)).toBe(1);
    expect(await slotOf(itemIds[1], roomA)).toBe(2);
    expect(await slotOf(itemIds[2], roomA)).toBe(3);
  });

  it("restarts numbering in a different location", async () => {
    // The item that is #3 in room A is the first thing to land in room B.
    expect((await stockUp(itemIds[2], roomB, 5)).status).toBe(201);
    expect(await slotOf(itemIds[2], roomB)).toBe(1);
    // ...and its number in room A is untouched.
    expect(await slotOf(itemIds[2], roomA)).toBe(3);
  });

  it("keeps an item's number when its quantity changes", async () => {
    const before = await slotOf(itemIds[1], roomA);
    const move = await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemIds[1], location_id: roomA, delta: -4, reason: "take" });
    expect(move.status).toBe(201);
    expect(await slotOf(itemIds[1], roomA)).toBe(before);
  });

  it("gives every item in a location a number, and never the same one twice", async () => {
    const res = await app.get(`/stock?location_id=${roomA}`).set(adminH);
    const slots = res.body.map((r: { slot_no: number | null }) => r.slot_no);
    expect(slots.every((s: number | null) => typeof s === "number" && s > 0)).toBe(true);
    expect(new Set(slots).size).toBe(slots.length);
  });
});

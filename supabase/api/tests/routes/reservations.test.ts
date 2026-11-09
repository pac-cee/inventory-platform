import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { makeLevel, removePlaces } from "../helpers/places.js";
import { exec } from "../../src/db.js";

// Reserve (0043): hold units at a location for a window of dates.
describe("reservations", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>; // Tony
  let managerH: Record<string, string>;
  let memberId: string;
  let managerId: string;
  const stamp = Date.now();
  let sharedLevel = "";
  const made: { items: string[]; boxes: string[]; places: string[] } = { items: [], boxes: [], places: [] };
  const day = (n: number, extraMs = 0) => new Date(Date.now() + n * 86_400_000 + extraMs).toISOString();
  // "From now": a few seconds back, so the database clock cannot see it as still in the future.
  const now = () => new Date(Date.now() - 5000).toISOString();

  /** A fresh item with `units` on the shelf in its own box, so tests cannot affect each other. */
  async function stocked(units: number) {
    // One Area > Shelf > Level for the whole file; each test only adds a box on it.
    if (!sharedLevel) {
      const chain = await makeLevel(app, adminH, `res-${stamp}`);
      sharedLevel = chain.level;
      made.places.push(...chain.ids);
    }
    const box = await app.post("/locations").set(adminH).send({ name: `res-box-${stamp}-${made.boxes.length}`, kind: "box", parent_id: sharedLevel });
    made.places.push(box.body.id);
    const item = await app.post("/items").set(adminH).send({ type: `res-item-${stamp}-${made.items.length}`, name: `res-item-${stamp}-${made.items.length}`, model: "Unspecified" });
    made.boxes.push(box.body.id);
    made.items.push(item.body.id);
    await app.post("/movements").set(adminH).send({ item_id: item.body.id, location_id: box.body.id, delta: units, capacity_delta: units, reason: "initial" });
    return { itemId: item.body.id as string, boxId: box.body.id as string };
  }
  const reserve = (h: Record<string, string>, s: { itemId: string; boxId: string }, quantity: number, starts: string, ends: string, extra: Record<string, unknown> = {}) =>
    app.post("/reservations").set(h).send({ item_id: s.itemId, location_id: s.boxId, quantity, starts_at: starts, ends_at: ends, ...extra });
  const take = (h: Record<string, string>, s: { itemId: string; boxId: string }, quantity: number) =>
    app.post("/movements/check-out").set(h).send({ item_id: s.itemId, location_id: s.boxId, quantity });

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    managerH = await authHeaders("manager");
    memberId = (await app.get("/auth/me").set(memberH)).body.user.id;
    managerId = (await app.get("/auth/me").set(managerH)).body.user.id;
  });

  afterAll(async () => {
    await exec("update profiles set blocked = false where id = $1", [memberId]);
    for (const id of made.items) await app.delete(`/items/${id}`).set(adminH).catch(() => {});
    await removePlaces(app, adminH, made.places);
  }, 240_000); // every test builds its own Area > Shelf > Level > Box, so there is a lot to tidy

  describe("making one", () => {
    it("is approved on the spot when stock allows, with names and a derived state", async () => {
      const s = await stocked(10);
      const res = await reserve(memberH, s, 4, day(1), day(3), { note: "for the demo" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ quantity: 4, status: "approved", state: "upcoming", user_id: memberId, requested_by: memberId, note: "for the demo" });
      expect(res.body.item_name).toContain("res-item-");
      expect(res.body.location_name).toContain("res-box-");
    });

    it("refuses a bad window", async () => {
      const s = await stocked(10);
      expect((await reserve(memberH, s, 1, day(-2), day(1))).body.error.code).toBe("invalid_window");
      expect((await reserve(memberH, s, 1, day(2), day(2))).status).toBe(422); // ends when it starts
      expect((await reserve(memberH, s, 1, day(40), day(41))).status).toBe(422); // too far ahead
      expect((await reserve(memberH, s, 1, day(1), day(20))).status).toBe(422); // too long
    });

    it("refuses more than is available for those dates, saying how many are", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 4, day(1), day(5));
      const res = await reserve(managerH, s, 7, day(2), day(4)); // overlaps; only 6 left
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("not_enough_available");
      expect(res.body.error.message).toBe("Only 6 available for those dates.");
    });

    it("allows the same units again in a window that does not overlap", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 10, day(1), day(3));
      expect((await reserve(managerH, s, 10, day(3), day(5))).status).toBe(201); // starts as the first ends
    });

    it("refuses a location the item is not stocked at", async () => {
      const s = await stocked(5);
      const other = await app.post("/locations").set(adminH).send({ name: `res-empty-${stamp}` });
      made.boxes.push(other.body.id);
      const res = await reserve(memberH, { itemId: s.itemId, boxId: other.body.id }, 1, day(1), day(2));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("not_registered_here");
    });

    it("two people reserving the last units at once: exactly one wins", async () => {
      const s = await stocked(10);
      const [a, b] = await Promise.all([
        reserve(memberH, s, 6, day(1), day(3)),
        reserve(managerH, s, 6, day(1), day(3)),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
    });
  });

  describe("an active reservation holds units back", () => {
    it("others cannot take reserved units, but can take the rest", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 4, now(), day(2)); // Tony, active now
      const tooMany = await take(managerH, s, 8); // 10 on shelf, 4 reserved for Tony → 6 free
      expect(tooMany.status).toBe(409);
      expect(tooMany.body.error.code).toBe("reserved_for_others");
      expect(tooMany.body.error.message).toBe("4 units are reserved for other people right now — only 6 can be taken.");
      expect((await take(managerH, s, 6)).status).toBe(201);
    });

    it("an upcoming reservation does not block taking now", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 8, day(5), day(7));
      expect((await take(managerH, s, 10)).status).toBe(201);
    });

    it("the person it is for is not blocked by their own reservation", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 10, now(), day(2));
      expect((await take(memberH, s, 10)).status).toBe(201);
    });
  });

  describe("collecting it", () => {
    it("taking the reserved units fulfils the reservation and links the take", async () => {
      const s = await stocked(10);
      const r = await reserve(memberH, s, 3, now(), day(2));
      const t = await take(memberH, s, 3);
      expect(t.status).toBe(201);

      expect((await app.get(`/reservations?item_id=${s.itemId}`).set(memberH)).body).toEqual([]); // no longer standing
      const hist = (await app.get(`/reservations?item_id=${s.itemId}&all=1`).set(memberH)).body;
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ id: r.body.id, status: "fulfilled", state: "fulfilled" });
    });

    it("taking less than reserved leaves the rest reserved", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 5, now(), day(2));
      await take(memberH, s, 2);
      const left = (await app.get(`/reservations?item_id=${s.itemId}`).set(memberH)).body;
      expect(left).toHaveLength(1);
      expect(left[0]).toMatchObject({ quantity: 3, status: "approved", state: "active" });
    });

    it("a manager taking on the person's behalf collects their reservation too", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 2, now(), day(2));
      expect((await app.post("/movements/check-out").set(managerH).send({ item_id: s.itemId, location_id: s.boxId, quantity: 2, on_behalf_of: memberId })).status).toBe(201);
      expect((await app.get(`/reservations?item_id=${s.itemId}`).set(memberH)).body).toEqual([]);
    });
  });

  describe("cancelling", () => {
    it("the owner cancels, and the units are free for others straight away", async () => {
      const s = await stocked(10);
      const r = await reserve(memberH, s, 6, now(), day(2));
      expect((await take(managerH, s, 8)).status).toBe(409);
      const res = await app.post(`/reservations/${r.body.id}/cancel`).set(memberH);
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("cancelled");
      expect((await take(managerH, s, 8)).status).toBe(201);
    });

    it("cannot be cancelled twice", async () => {
      const s = await stocked(5);
      const r = await reserve(memberH, s, 1, day(1), day(2));
      await app.post(`/reservations/${r.body.id}/cancel`).set(memberH);
      const again = await app.post(`/reservations/${r.body.id}/cancel`).set(memberH);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("not_cancellable");
    });

    it("someone else's reservation can be cancelled only by a manager", async () => {
      const s = await stocked(5);
      const r = await reserve(memberH, s, 1, day(1), day(2));
      // make the manager an ordinary member for one call
      await exec("update profiles set role = 'member' where id = $1", [managerId]);
      try {
        expect((await app.post(`/reservations/${r.body.id}/cancel`).set(managerH)).status).toBe(403);
      } finally {
        await exec("update profiles set role = 'stock_manager' where id = $1", [managerId]);
      }
      expect((await app.post(`/reservations/${r.body.id}/cancel`).set(managerH)).status).toBe(200);
    });
  });

  describe("who sees what", () => {
    it("members see only their own; managers see everyone's and can filter", async () => {
      const s = await stocked(10);
      await reserve(memberH, s, 1, day(1), day(2));
      await reserve(managerH, s, 1, day(1), day(2));
      const mine = (await app.get(`/reservations?item_id=${s.itemId}`).set(memberH)).body;
      expect(mine.map((r: any) => r.user_id)).toEqual([memberId]);
      expect((await app.get(`/reservations?item_id=${s.itemId}`).set(managerH)).body).toHaveLength(2);
      expect((await app.get(`/reservations?item_id=${s.itemId}&user_id=${memberId}`).set(managerH)).body).toHaveLength(1);
    });
  });

  describe("on someone's behalf", () => {
    it("a manager reserves for a person; the person can cancel it", async () => {
      const s = await stocked(10);
      const r = await reserve(managerH, s, 2, day(1), day(3), { for_user_id: memberId });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ user_id: memberId, requested_by: managerId });
      expect((await app.post(`/reservations/${r.body.id}/cancel`).set(memberH)).status).toBe(200);
    });

    it("a non-manager cannot, and a blocked person cannot be reserved for", async () => {
      const s = await stocked(10);
      expect((await reserve(memberH, s, 1, day(1), day(2), { for_user_id: managerId })).status).toBe(403);
      await exec("update profiles set blocked = true where id = $1", [memberId]);
      try {
        const res = await reserve(managerH, s, 1, day(1), day(2), { for_user_id: memberId });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("user_not_active");
      } finally {
        await exec("update profiles set blocked = false where id = $1", [memberId]);
      }
    });
  });

  describe("availability", () => {
    it("separates what others hold now, what is mine, and what is held for later", async () => {
      const s = await stocked(20);
      await reserve(managerH, s, 5, now(), day(2)); // others', active now
      await reserve(memberH, s, 3, now(), day(2)); // mine, active now
      await reserve(managerH, s, 4, day(6), day(8)); // upcoming
      const a = (await app.get(`/reservations/availability?item_id=${s.itemId}&location_id=${s.boxId}`).set(memberH)).body;
      expect(a).toEqual({ on_shelf: 20, reserved_for_others_now: 5, reserved_for_me_now: 3, reserved_upcoming: 4, available_to_me_now: 15 });
    });
  });
});

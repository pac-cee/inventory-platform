import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { makeBox, removePlaces } from "../helpers/places.js";
import { exec, maybeOne } from "../../src/db.js";

// Take/return with an expected return date (0042).
describe("loans — expected return dates", () => {
  let places: string[] = [];
  let adminH: Record<string, string>;
  let memberH: Record<string, string>; // Tony, the borrower
  let managerH: Record<string, string>; // another borrower, and a manager
  let memberId: string;
  let itemId: string;
  let boxId: string;
  const stamp = Date.now();
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

  const take = (h: Record<string, string>, quantity: number, due?: string | null) =>
    app.post("/movements/check-out").set(h).send({ item_id: itemId, location_id: boxId, quantity, expected_return_at: due });
  const giveBack = (h: Record<string, string>, quantity: number) =>
    app.post("/movements/check-in").set(h).send({ item_id: itemId, location_id: boxId, quantity });
  const borrowed = (h: Record<string, string>, query = "") => app.get(`/movements/borrowed?item_id=${itemId}${query}`).set(h);
  const onHand = async () =>
    (await app.get(`/items/${itemId}/stock`).set(adminH)).body.find((s: any) => s.location_id === boxId)?.quantity as number;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    managerH = await authHeaders("manager");
    memberId = (await app.get("/auth/me").set(memberH)).body.user.id;
    const made = await makeBox(app, adminH, `loan-box-${stamp}`);
    places = made.chain;
    boxId = made.box.body.id;
    const item = await app.post("/items").set(adminH).send({ type: `loan-item-${stamp}`, name: `loan-item-${stamp}`, model: "Unspecified" });
    itemId = item.body.id;
    await app.post("/movements").set(adminH).send({ item_id: itemId, location_id: boxId, delta: 50, capacity_delta: 50, reason: "initial" });
  });

  afterAll(async () => {
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    await removePlaces(app, adminH, places);
  });

  it("a take can carry a return date, and the answer says so", async () => {
    const due = inDays(3);
    const res = await take(memberH, 2, due);
    expect(res.status).toBe(201);
    expect(new Date(res.body.expected_return_at).getTime()).toBe(new Date(due).getTime());
  });

  it("the borrowed list shows it, with the item name and an upcoming status", async () => {
    const res = await borrowed(memberH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ item_id: itemId, item_name: `loan-item-${stamp}`, quantity: 2, user_id: memberId, status: "upcoming", days_overdue: 0 });
  });

  it("a take with no date is an open-ended loan", async () => {
    const res = await take(managerH, 1);
    expect(res.status).toBe(201);
    expect(res.body.expected_return_at).toBeNull();
    // (a manager's unfiltered list is everyone's — narrow it to their own)
    const managerId = (await app.get("/auth/me").set(managerH)).body.user.id;
    const mine = await borrowed(managerH, `&user_id=${managerId}`);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ quantity: 1, expected_return_at: null, status: "none" });
  });

  it("a member sees only their own loans; a manager sees everyone's and can filter", async () => {
    expect((await borrowed(memberH)).body.map((l: any) => l.user_id)).toEqual([memberId]);
    expect((await borrowed(managerH)).body).toHaveLength(2);
    const filtered = await borrowed(managerH, `&user_id=${memberId}`);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].user_id).toBe(memberId);
  });

  it("a member cannot widen the view with user_id", async () => {
    const res = await borrowed(memberH, `&user_id=${(await app.get("/auth/me").set(managerH)).body.user.id}`);
    expect(res.body.every((l: any) => l.user_id === memberId)).toBe(true);
  });

  it("refuses a past date and changes no stock", async () => {
    const before = await onHand();
    const res = await take(memberH, 1, inDays(-1));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("invalid_return_date");
    expect(await onHand()).toBe(before);
  });

  it("refuses a date more than a year out, and a malformed one", async () => {
    expect((await take(memberH, 1, inDays(500))).status).toBe(422);
    expect((await take(memberH, 1, "next friday")).status).toBe(422);
  });

  describe("returns clear the OLDEST take first", () => {
    it("keeps the later take's date after a partial return", async () => {
      // Member holds 2 (due +3d). Add 3 more due +10d, then return 2.
      const later = inDays(10);
      await take(memberH, 3, later);
      expect((await giveBack(memberH, 2)).status).toBe(201);

      const loans = (await borrowed(memberH)).body;
      expect(loans).toHaveLength(1);
      expect(loans[0].quantity).toBe(3);
      expect(new Date(loans[0].expected_return_at).getTime()).toBe(new Date(later).getTime());
    });

    it("returning the rest empties the list", async () => {
      expect((await giveBack(memberH, 3)).status).toBe(201);
      expect((await borrowed(memberH)).body).toEqual([]);
    });
  });

  describe("extending a date", () => {
    let takeId: string;
    const first = inDays(2);

    beforeAll(async () => {
      const res = await take(memberH, 1, first);
      takeId = res.body.id;
    });

    it("the holder can push their own date, and the first one is kept for audit", async () => {
      const later = inDays(9);
      const res = await app.post(`/movements/${takeId}/extend`).set(memberH).send({ expected_return_at: later });
      expect(res.status).toBe(200);
      const row = await maybeOne<{ expected_return_at: Date; original_expected_return_at: Date }>(
        "select expected_return_at, original_expected_return_at from loan_due_dates where movement_id = $1",
        [takeId],
      );
      expect(row!.expected_return_at.getTime()).toBe(new Date(later).getTime());
      expect(row!.original_expected_return_at.getTime()).toBe(new Date(first).getTime());
    });

    it("another (non-manager) member cannot change it", async () => {
      // The manager persona is only a manager by role — make them an ordinary
      // member for this one call, then put the role back.
      const managerId = (await app.get("/auth/me").set(managerH)).body.user.id;
      await exec("update profiles set role = 'member' where id = $1", [managerId]);
      try {
        const res = await app.post(`/movements/${takeId}/extend`).set(managerH).send({ expected_return_at: inDays(5) });
        expect(res.status).toBe(403);
      } finally {
        await exec("update profiles set role = 'stock_manager' where id = $1", [managerId]);
      }
      expect((await app.post(`/movements/${takeId}/extend`).send({ expected_return_at: inDays(5) })).status).toBe(401);
    });

    it("a manager can change anyone's", async () => {
      const res = await app.post(`/movements/${takeId}/extend`).set(managerH).send({ expected_return_at: inDays(12) });
      expect(res.status).toBe(200);
    });

    it("refuses a past date", async () => {
      expect((await app.post(`/movements/${takeId}/extend`).set(memberH).send({ expected_return_at: inDays(-2) })).status).toBe(422);
    });

    it("404s something that is not a take", async () => {
      const ret = await giveBack(memberH, 1);
      expect((await app.post(`/movements/${ret.body.id}/extend`).set(memberH).send({ expected_return_at: inDays(5) })).status).toBe(404);
    });

    it("409s a loan that has already been returned", async () => {
      const res = await app.post(`/movements/${takeId}/extend`).set(memberH).send({ expected_return_at: inDays(5) });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("already_returned");
    });
  });

  describe("overdue", () => {
    it("a loan past its date shows as overdue, counted in days, and sorts first", async () => {
      const open = await take(memberH, 1); // open-ended, so it must sort AFTER the overdue one
      expect(open.status).toBe(201);
      const late = await take(memberH, 1, inDays(2));
      // The API refuses a past date, so age this loan directly: five days late.
      await exec("update loan_due_dates set expected_return_at = now() - interval '5 days' where movement_id = $1", [late.body.id]);

      const loans = (await borrowed(memberH)).body;
      expect(loans[0]).toMatchObject({ take_id: late.body.id, status: "overdue" });
      expect(loans[0].days_overdue).toBeGreaterThanOrEqual(4);
      expect(loans[loans.length - 1].status).toBe("none");
    });
  });
});

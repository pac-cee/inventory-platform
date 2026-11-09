import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { makeBox, removePlaces } from "../helpers/places.js";
import { exec, maybeOne } from "../../src/db.js";

// A manager records a take/return FOR someone: the ledger row is the person's
// (user_id) and the manager is recorded_by.
describe("recording on someone's behalf", () => {
  let places: string[] = [];
  let adminH: Record<string, string>;
  let managerH: Record<string, string>;
  let memberH: Record<string, string>;
  let managerId: string;
  let memberId: string;
  let itemId: string;
  let boxId: string;
  const stamp = Date.now();
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

  const body = (quantity: number, extra: Record<string, unknown> = {}) => ({ item_id: itemId, location_id: boxId, quantity, ...extra });
  const takeFor = (h: Record<string, string>, quantity: number, extra: Record<string, unknown> = {}) =>
    app.post("/movements/check-out").set(h).send(body(quantity, extra));
  const returnFor = (h: Record<string, string>, quantity: number, extra: Record<string, unknown> = {}) =>
    app.post("/movements/check-in").set(h).send(body(quantity, extra));
  const loans = async (h: Record<string, string>) => (await app.get(`/movements/borrowed?item_id=${itemId}`).set(h)).body as any[];
  const onHand = async () =>
    (await app.get(`/items/${itemId}/stock`).set(adminH)).body.find((s: any) => s.location_id === boxId)?.quantity as number;
  const row = (id: string) =>
    maybeOne<{ user_id: string; recorded_by: string }>("select user_id, recorded_by from stock_movements where id = $1", [id]);

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    managerH = await authHeaders("manager");
    memberH = await authHeaders("member");
    managerId = (await app.get("/auth/me").set(managerH)).body.user.id;
    memberId = (await app.get("/auth/me").set(memberH)).body.user.id;
    const made = await makeBox(app, adminH, `behalf-box-${stamp}`);
    places = made.chain;
    boxId = made.box.body.id;
    const item = await app.post("/items").set(adminH).send({ type: `behalf-item-${stamp}`, name: `behalf-item-${stamp}`, model: "Unspecified" });
    itemId = item.body.id;
    await app.post("/movements").set(adminH).send({ item_id: itemId, location_id: boxId, delta: 40, capacity_delta: 40, reason: "initial" });
  });

  afterAll(async () => {
    await exec("update profiles set blocked = false where id = $1", [memberId]);
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    await removePlaces(app, adminH, places);
  });

  it("a manager takes for a person: the row is the person's, recorded by the manager", async () => {
    const res = await takeFor(managerH, 3, { on_behalf_of: memberId });
    expect(res.status).toBe(201);
    const r = await row(res.body.id);
    expect(r!.user_id).toBe(memberId);
    expect(r!.recorded_by).toBe(managerId);
  });

  it("the loan belongs to the person, not the manager", async () => {
    const mine = await loans(memberH);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ user_id: memberId, quantity: 3 });
    const asManager = (await loans(managerH)).filter((l) => l.user_id === managerId);
    expect(asManager).toEqual([]);
  });

  it("a return date works on someone's behalf too", async () => {
    const due = inDays(4);
    await takeFor(managerH, 1, { on_behalf_of: memberId, expected_return_at: due });
    const dated = (await loans(memberH)).find((l) => l.expected_return_at);
    expect(new Date(dated.expected_return_at).getTime()).toBe(new Date(due).getTime());
  });

  it("a manager returns for the person; the ceiling is what THE PERSON holds", async () => {
    // Person holds 4 (3 + 1). The manager holds nothing themselves.
    expect((await returnFor(managerH, 2, { on_behalf_of: memberId })).status).toBe(201);
    expect((await loans(memberH)).reduce((s, l) => s + l.quantity, 0)).toBe(2);

    const tooMany = await returnFor(managerH, 5, { on_behalf_of: memberId });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe("return_exceeds_held");
    expect(tooMany.body.error.message).toMatch(/They can only return up to 2/);
  });

  it("returning for someone who holds none says so", async () => {
    const res = await returnFor(adminH, 1, { on_behalf_of: managerId });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/They have none/);
  });

  it("the manager's OWN holdings do not count towards a return for someone else", async () => {
    await takeFor(managerH, 5); // manager now holds 5 themselves
    const res = await returnFor(managerH, 5, { on_behalf_of: memberId }); // member only holds 2
    expect(res.status).toBe(422);
    // and their own return still works
    expect((await returnFor(managerH, 5)).status).toBe(201);
  });

  it("a non-manager cannot record for someone else, and no stock moves", async () => {
    const before = await onHand();
    const res = await takeFor(memberH, 1, { on_behalf_of: managerId });
    expect(res.status).toBe(403);
    expect((await returnFor(memberH, 1, { on_behalf_of: managerId })).status).toBe(403);
    expect(await onHand()).toBe(before);
  });

  it("refuses a person who does not exist", async () => {
    const res = await takeFor(managerH, 1, { on_behalf_of: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("user_not_found");
  });

  it("refuses a blocked account and changes no stock", async () => {
    await exec("update profiles set blocked = true where id = $1", [memberId]);
    try {
      const before = await onHand();
      const res = await takeFor(managerH, 1, { on_behalf_of: memberId });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("user_not_active");
      expect(await onHand()).toBe(before);
    } finally {
      await exec("update profiles set blocked = false where id = $1", [memberId]);
    }
  });

  it("naming yourself is just recording for yourself", async () => {
    const res = await takeFor(managerH, 1, { on_behalf_of: managerId });
    expect(res.status).toBe(201);
    const r = await row(res.body.id);
    expect(r!.user_id).toBe(managerId);
    expect(r!.recorded_by).toBe(managerId);
    await returnFor(managerH, 1);
  });

  it("the history shows both people", async () => {
    const res = await app.get(`/movements?item_id=${itemId}`).set(managerH);
    expect(res.status).toBe(200);
    const behalf = res.body.find((m: any) => m.user_id === memberId && m.recorded_by === managerId && m.reason === "take");
    expect(behalf).toBeTruthy();
  });
});

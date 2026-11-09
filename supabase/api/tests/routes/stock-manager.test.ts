import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { itemPayload } from "../helpers/items.js";
import { exec, one } from "../../src/db.js";

/**
 * The stock_manager boundary (0040).
 *
 * The point of the role is that it runs the warehouse and never touches money
 * or people. That is easy to break by widening one guard, so the money and
 * user-management routes are asserted 403 here as a set rather than trusted to
 * review. Add a route to either side and add it to the matching list.
 */

const PASSWORD = "StockPass123!";
const email = `stock-manager-${Date.now()}@inventory.test`;

let managerH: Record<string, string>;
let adminH: Record<string, string>;
let userId: string;
let locationId: string;

beforeAll(async () => {
  adminH = await authHeaders("admin");

  const signup = await app.post("/auth/signup").send({ email, password: PASSWORD });
  expect([201, 400]).toContain(signup.status);

  // Sign-ups arrive unverified, blocked and pending (0037); let this one in and
  // make it a stock manager.
  const row = await one<{ id: string }>("select id from users where email = $1", [email]);
  userId = row.id;
  await exec("update users set email_confirmed = true where id = $1", [userId]);
  await exec(
    `update profiles set role = 'stock_manager', approval_status = 'approved', blocked = false
       where id = $1`,
    [userId],
  );

  const login = await app.post("/auth/login").send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  managerH = { Authorization: `Bearer ${login.body.session.access_token}` };

  const loc = await app
    .post("/locations")
    .set(adminH)
    .send({ name: `sm-loc-${Date.now()}` });
  locationId = loc.body.id as string;
});

afterAll(async () => {
  if (locationId) await app.delete(`/locations/${locationId}`).set(adminH);
  if (userId) await exec("delete from users where id = $1", [userId]);
});

describe("stock_manager runs the warehouse", () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await app.delete(`/items/${id}`).set(adminH);
  });

  it("can create an item", async () => {
    const res = await app.post("/items").set(managerH).send(itemPayload({ type: "SM Cable" }));
    expect(res.status).toBe(201);
    expect(res.body.sku).toMatch(/^vrlt-/);
    created.push(res.body.id as string);
  });

  it("can edit and delete an item", async () => {
    const res = await app.post("/items").set(managerH).send(itemPayload({ type: "SM Widget" }));
    expect(res.status).toBe(201);
    const id = res.body.id as string;

    const patched = await app.patch(`/items/${id}`).set(managerH).send({ model: "REV-2" });
    expect(patched.status).toBe(200);
    expect(patched.body.model).toBe("REV-2");

    expect((await app.delete(`/items/${id}`).set(managerH)).status).toBeLessThan(300);
  });

  it("can create a location", async () => {
    const res = await app
      .post("/locations")
      .set(managerH)
      .send({ name: `sm-created-loc-${Date.now()}` });
    expect(res.status).toBe(201);
    await app.delete(`/locations/${res.body.id as string}`).set(adminH);
  });

  it("can record stock movements", async () => {
    const item = await app.post("/items").set(managerH).send(itemPayload({ type: "SM Stocked" }));
    const itemId = item.body.id as string;
    created.push(itemId);

    const res = await app
      .post("/movements")
      .set(managerH)
      .send({ item_id: itemId, location_id: locationId, delta: 5, reason: "initial" });
    expect(res.status).toBe(201);
  });

  it("can read the stock reports", async () => {
    expect((await app.get("/reports/condition").set(managerH)).status).toBe(200);
    expect((await app.get("/movements/report").set(managerH)).status).toBe(200);
    expect((await app.get("/admin/low-stock").set(managerH)).status).toBe(200);
  });
});

describe("stock_manager touches neither money nor people", () => {
  it.each([
    ["post", "/payments/resolve"],
    ["get", "/payments/balance"],
    ["get", "/payments/budgets"],
    ["post", "/payments/budgets"],
    ["get", "/payments/reports/detailed"],
  ])("is refused %s %s", async (method, path) => {
    const req = (app as any)[method](path).set(managerH);
    const res = await (method === "post" ? req.send({}) : req);
    expect(res.status).toBe(403);
  });

  it.each([
    ["get", "/users"],
    ["post", "/users"],
  ])("is refused %s %s", async (method, path) => {
    const req = (app as any)[method](path).set(managerH);
    const res = await (method === "post" ? req.send({}) : req);
    expect(res.status).toBe(403);
  });

  it("cannot change anyone's role", async () => {
    const res = await app.patch(`/profiles/${userId}/role`).set(managerH).send({ role: "admin" });
    expect(res.status).toBe(403);
  });

  it("cannot grant itself inventory access on someone else", async () => {
    const res = await app
      .patch(`/profiles/${userId}/inventory-access`)
      .set(managerH)
      .send({ can_manage_inventory: true });
    expect(res.status).toBe(403);
  });
});

describe("can_manage_inventory grants the same rights without the role", () => {
  const memberEmail = `inv-flag-${Date.now()}@inventory.test`;
  let flaggedH: Record<string, string>;
  let flaggedId: string;

  beforeAll(async () => {
    await app.post("/auth/signup").send({ email: memberEmail, password: PASSWORD });
    const row = await one<{ id: string }>("select id from users where email = $1", [memberEmail]);
    flaggedId = row.id;
    await exec("update users set email_confirmed = true where id = $1", [flaggedId]);
    await exec(
      `update profiles set approval_status = 'approved', blocked = false where id = $1`,
      [flaggedId],
    );
    const login = await app.post("/auth/login").send({ email: memberEmail, password: PASSWORD });
    flaggedH = { Authorization: `Bearer ${login.body.session.access_token}` };
  });

  afterAll(async () => {
    if (flaggedId) await exec("delete from users where id = $1", [flaggedId]);
  });

  it("a plain member cannot create an item", async () => {
    const res = await app.post("/items").set(flaggedH).send(itemPayload({ type: "Flag Denied" }));
    expect(res.status).toBe(403);
  });

  it("the same member can once an admin grants inventory access", async () => {
    const grant = await app
      .patch(`/profiles/${flaggedId}/inventory-access`)
      .set(adminH)
      .send({ can_manage_inventory: true });
    expect(grant.status).toBe(200);

    const res = await app.post("/items").set(flaggedH).send(itemPayload({ type: "Flag Allowed" }));
    expect(res.status).toBe(201);
    await app.delete(`/items/${res.body.id as string}`).set(adminH);
  });

  it("but still cannot approve a payment", async () => {
    const res = await app.post("/payments/resolve").set(flaggedH).send({});
    expect(res.status).toBe(403);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { maybeOne } from "../../src/db.js";

// The inventory manager (stock_manager, 0039): everything about stock, nothing
// about people. Members stay unable to do either.
describe("stock_manager role", () => {
  let adminH: Record<string, string>;
  let managerH: Record<string, string>;
  let memberH: Record<string, string>;
  let managerId: string;
  const locationIds: string[] = [];
  const itemIds: string[] = [];

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    managerH = await authHeaders("manager");
    memberH = await authHeaders("member");
    managerId = (await app.get("/auth/me").set(managerH)).body.user.id;
  });

  afterAll(async () => {
    for (const id of itemIds) await app.delete(`/items/${id}`).set(adminH).catch(() => {});
    for (const id of locationIds) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
  });

  it("the seeded manager really has the stock_manager role", async () => {
    const row = await maybeOne<{ role: string }>("select role from profiles where id = $1", [managerId]);
    expect(row?.role).toBe("stock_manager");
  });

  describe("can manage stock", () => {
    it("creates, edits and removes a location", async () => {
      const created = await app.post("/locations").set(managerH).send({ name: `mgr-loc-${Date.now()}` });
      expect(created.status).toBe(201);
      locationIds.push(created.body.id);

      const renamed = await app.patch(`/locations/${created.body.id}`).set(managerH).send({ name: `mgr-loc-renamed-${Date.now()}` });
      expect(renamed.status).toBe(200);

      const removed = await app.delete(`/locations/${created.body.id}`).set(managerH);
      expect(removed.status).toBeLessThan(300);
    });

    it("creates and edits an item", async () => {
      const created = await app.post("/items").set(managerH).send({ type: "Mgr test", name: `mgr-item-${Date.now()}`, model: "M1" });
      expect(created.status).toBe(201);
      itemIds.push(created.body.id);

      const edited = await app.patch(`/items/${created.body.id}`).set(managerH).send({ specification: "edited by manager" });
      expect(edited.status).toBe(200);
    });

    it("can use the admin-only stock tools (adjust is not a 403)", async () => {
      // A bad body is a 400/404/422 — what matters is that the role gate let them in.
      const res = await app.post("/movements/adjust").set(managerH).send({});
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });

    it("can read the activity and condition reports", async () => {
      expect((await app.get("/movements/report").set(managerH)).status).not.toBe(403);
      expect((await app.get("/reports/condition").set(managerH)).status).not.toBe(403);
    });
  });

  describe("cannot manage people", () => {
    it("cannot change anyone's role", async () => {
      const res = await app.patch(`/profiles/${managerId}/role`).set(managerH).send({ role: "admin" });
      expect(res.status).toBe(403);
      const row = await maybeOne<{ role: string }>("select role from profiles where id = $1", [managerId]);
      expect(row?.role).toBe("stock_manager"); // no self-promotion
    });

    it("cannot use the user-management routes", async () => {
      expect((await app.get("/users").set(managerH)).status).toBe(403);
      expect((await app.post("/users").set(managerH).send({ email: "x@y.test", password: "TestPass123!", full_name: "X" })).status).toBe(403);
    });

    it("cannot set payment limits", async () => {
      const res = await app.patch(`/payments/profiles/${managerId}/payment-settings`).set(managerH).send({ daily_limit: 1 });
      expect(res.status).toBe(403);
    });
  });

  describe("members stay locked out of both", () => {
    it("cannot create a location or an item", async () => {
      expect((await app.post("/locations").set(memberH).send({ name: "nope" })).status).toBe(403);
      expect((await app.post("/items").set(memberH).send({ type: "x", name: "nope", model: "m" })).status).toBe(403);
    });
  });

  describe("admins can hand the role out", () => {
    it("an admin can assign stock_manager through the role endpoint", async () => {
      const memberId = (await app.get("/auth/me").set(memberH)).body.user.id;
      const res = await app.patch(`/profiles/${memberId}/role`).set(adminH).send({ role: "stock_manager" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("stock_manager");
      // put it back so other test files see an ordinary member
      await app.patch(`/profiles/${memberId}/role`).set(adminH).send({ role: "member" });
    });

    it("rejects a role that does not exist", async () => {
      const memberId = (await app.get("/auth/me").set(memberH)).body.user.id;
      const res = await app.patch(`/profiles/${memberId}/role`).set(adminH).send({ role: "superuser" });
      expect(res.status).toBe(422); // validation errors are 422 across this API
    });
  });
});

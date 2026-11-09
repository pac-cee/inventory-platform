import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * Suggested changes (0035).
 *
 * A suggestion is what should be done to an item that still works — an upgrade,
 * a service — as opposed to a fault, which is damage and moves stock. The two
 * must stay independent: raising a suggestion must not touch any count.
 *
 * Anyone signed in can raise one; only an admin can close one.
 */
describe("item suggestions", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let itemId: string;
  let roomId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    const room = await app.post("/locations").set(adminH).send({ name: `sug-room-${stamp}` });
    roomId = room.body.id;

    const item = await app
      .post("/items")
      .set(adminH)
      .send({ type: `sug-laptop-${stamp}`, name: `SUG-${stamp}`, model: "Std", category: "Computers" });
    itemId = item.body.id;

    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: roomId, delta: 10, reason: "initial" });
  });

  it("lets any signed-in user raise one", async () => {
    const res = await app.post("/suggestions").set(memberH).send({
      item_id: itemId,
      location_id: roomId,
      note: "Upgrade to 16GB RAM",
      kind: "upgrade",
      units: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.note).toBe("Upgrade to 16GB RAM");
    expect(res.body.kind).toBe("upgrade");
    expect(res.body.resolved_at).toBeNull();
  });

  it("does not touch stock — the item is not damaged", async () => {
    const report = await app.get(`/reports/condition?item_id=${itemId}`).set(adminH);
    const row = report.body[0];
    expect(row.total).toBe(10);
    expect(row.damaged).toBe(0);
    expect(row.operational).toBe(10);
  });

  it("requires a note that says something", async () => {
    for (const note of ["", "  ", "ab"]) {
      const res = await app
        .post("/suggestions")
        .set(memberH)
        .send({ item_id: itemId, note });
      expect(res.status).toBe(422);
    }
  });

  it("rejects an unknown kind", async () => {
    const res = await app
      .post("/suggestions")
      .set(memberH)
      .send({ item_id: itemId, note: "Something", kind: "nonsense" });
    expect(res.status).toBe(422);
  });

  it("404s on an item that does not exist", async () => {
    const res = await app
      .post("/suggestions")
      .set(memberH)
      .send({ item_id: "00000000-0000-0000-0000-000000000000", note: "Upgrade it" });
    expect(res.status).toBe(404);
  });

  it("lists open suggestions for an item", async () => {
    const res = await app.get(`/suggestions?item_id=${itemId}`).set(memberH);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    // "sug-laptop" is the item TYPE since 0039; the name is its own field.
    expect(res.body[0].item_type).toContain("sug-laptop");
    expect(res.body[0].item_name).toBeTruthy();
    expect(res.body[0].item_sku).toMatch(/^vrlt-/);
    expect(res.body[0].created_by_name).toBeDefined();
  });

  it("only an admin can close one", async () => {
    const list = await app.get(`/suggestions?item_id=${itemId}`).set(memberH);
    const id = list.body[0].id;

    const denied = await app.post(`/suggestions/${id}/resolve`).set(memberH).send({});
    expect(denied.status).toBe(403);

    const ok = await app
      .post(`/suggestions/${id}/resolve`)
      .set(adminH)
      .send({ resolution: "RAM fitted" });
    expect(ok.status).toBe(200);
    expect(ok.body.resolved_at).not.toBeNull();
    expect(ok.body.resolution).toBe("RAM fitted");
  });

  it("a closed suggestion drops out of the open list", async () => {
    const open = await app.get(`/suggestions?item_id=${itemId}`).set(memberH);
    expect(open.body).toHaveLength(0);

    const all = await app
      .get(`/suggestions?item_id=${itemId}&include_resolved=true`)
      .set(memberH);
    expect(all.body.length).toBeGreaterThan(0);
  });

  it("will not close the same one twice", async () => {
    const all = await app
      .get(`/suggestions?item_id=${itemId}&include_resolved=true`)
      .set(adminH);
    const res = await app.post(`/suggestions/${all.body[0].id}/resolve`).set(adminH).send({});
    expect(res.status).toBe(404);
  });

  it("lets the author withdraw their own, but not someone else's", async () => {
    const mine = await app
      .post("/suggestions")
      .set(memberH)
      .send({ item_id: itemId, note: "Actually never mind" });
    expect(mine.status).toBe(201);

    const theirs = await app
      .post("/suggestions")
      .set(adminH)
      .send({ item_id: itemId, note: "Admin raised this" });
    expect(theirs.status).toBe(201);

    // A member cannot remove the admin's.
    expect((await app.delete(`/suggestions/${theirs.body.id}`).set(memberH)).status).toBe(403);
    // But can remove their own.
    expect((await app.delete(`/suggestions/${mine.body.id}`).set(memberH)).status).toBe(204);
    // And an admin can remove anyone's.
    expect((await app.delete(`/suggestions/${theirs.body.id}`).set(adminH)).status).toBe(204);
  });

  it("needs authentication", async () => {
    expect((await app.get("/suggestions")).status).toBe(401);
    expect((await app.post("/suggestions").send({ item_id: itemId, note: "x" })).status).toBe(401);
  });

  it("shows on the condition report without changing the numbers", async () => {
    const made = await app
      .post("/suggestions")
      .set(memberH)
      .send({ item_id: itemId, location_id: roomId, note: "Fit an SSD", kind: "upgrade" });
    expect(made.status).toBe(201);

    const report = await app.get(`/reports/condition?item_id=${itemId}`).set(adminH);
    const row = report.body[0];
    expect(row.suggestions).toHaveLength(1);
    expect(row.suggestions[0].note).toBe("Fit an SSD");
    // Still nothing wrong with it.
    expect(row.damaged).toBe(0);
    expect(row.operational).toBe(10);
  });

  it("drops off the report once resolved", async () => {
    const open = await app.get(`/suggestions?item_id=${itemId}`).set(adminH);
    await app.post(`/suggestions/${open.body[0].id}/resolve`).set(adminH).send({});

    const report = await app.get(`/reports/condition?item_id=${itemId}`).set(adminH);
    expect(report.body[0].suggestions).toHaveLength(0);
  });

  it("an item-wide suggestion shows at every location", async () => {
    const other = await app.post("/locations").set(adminH).send({ name: `sug-room2-${stamp}` });
    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: other.body.id, delta: 4, reason: "initial" });

    await app
      .post("/suggestions")
      .set(adminH)
      .send({ item_id: itemId, note: "Standardise the image", kind: "maintenance" });

    const report = await app.get(`/reports/condition?item_id=${itemId}`).set(adminH);
    expect(report.body.length).toBeGreaterThan(1);
    for (const row of report.body) {
      expect(row.suggestions.some((x: { note: string }) => x.note === "Standardise the image")).toBe(
        true,
      );
    }
  });
});

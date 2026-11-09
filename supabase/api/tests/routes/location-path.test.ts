import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { createItem } from "../helpers/items.js";

/**
 * A location's full path, everywhere an item's location is named.
 *
 * A leaf name on its own is ambiguous — "Level 5" says nothing about which
 * shelf in which room, which is exactly the confusion this fixes. The activity
 * report has always printed the whole path; these assert every other screen
 * now agrees.
 */

const SEP = " › ";

let adminH: Record<string, string>;
let roomId: string;
let rackId: string;
let levelId: string;
let itemId: string;
let fullPath: string;
let leafName: string;

beforeAll(async () => {
  adminH = await authHeaders("admin");
  const stamp = Date.now();

  const room = await app.post("/locations").set(adminH).send({ name: `Path Room ${stamp}` });
  roomId = room.body.id as string;
  const rack = await app
    .post("/locations")
    .set(adminH)
    .send({ name: `Rack B ${stamp}`, parent_id: roomId, kind: "shelf" });
  rackId = rack.body.id as string;
  const level = await app
    .post("/locations")
    .set(adminH)
    .send({ name: `Level 5 ${stamp}`, parent_id: rackId, kind: "level" });
  levelId = level.body.id as string;

  leafName = `Level 5 ${stamp}`;
  fullPath = [`Path Room ${stamp}`, `Rack B ${stamp}`, leafName].join(SEP);

  itemId = await createItem(adminH, { type: `Path Item ${stamp}` });
  const mv = await app
    .post("/movements")
    .set(adminH)
    .send({ item_id: itemId, location_id: levelId, delta: 3, reason: "initial" });
  expect(mv.status).toBe(201);
});

afterAll(async () => {
  if (itemId) await app.delete(`/items/${itemId}`).set(adminH);
  for (const id of [levelId, rackId, roomId]) {
    if (id) await app.delete(`/locations/${id}`).set(adminH);
  }
});

describe("an item's stock names the whole path", () => {
  it("GET /items/:id/stock — the item detail screen", async () => {
    const res = await app.get(`/items/${itemId}/stock`).set(adminH);
    expect(res.status).toBe(200);
    const row = res.body.find((r: { location_id: string }) => r.location_id === levelId);
    expect(row).toBeTruthy();
    expect(row.locations.name).toBe(fullPath);
    // The leaf alone was the ambiguity being fixed.
    expect(row.locations.name).not.toBe(leafName);
  });

  it("GET /stock — the stock listing", async () => {
    const res = await app.get(`/stock?item_id=${itemId}`).set(adminH);
    expect(res.status).toBe(200);
    const row = res.body.find((r: { location_id: string }) => r.location_id === levelId);
    expect(row).toBeTruthy();
    expect(row.locations.name).toBe(fullPath);
  });
});

describe("the condition report names the whole path", () => {
  it("GET /reports/condition", async () => {
    const res = await app.get("/reports/condition").set(adminH);
    expect(res.status).toBe(200);
    const row = res.body.find(
      (r: { item_id: string; location_id: string }) =>
        r.item_id === itemId && r.location_id === levelId,
    );
    expect(row).toBeTruthy();
    expect(row.location_name).toBe(fullPath);
    expect(row.location_name).not.toBe(leafName);
  });
});

describe("suggestions name the whole path", () => {
  it("GET /suggestions", async () => {
    const created = await app
      .post("/suggestions")
      .set(adminH)
      .send({ item_id: itemId, location_id: levelId, note: "needs a label", kind: "other" });
    expect(created.status).toBe(201);

    const res = await app.get(`/suggestions?item_id=${itemId}`).set(adminH);
    expect(res.status).toBe(200);
    expect(res.body[0].location_name).toBe(fullPath);
  });
});

describe("the activity report is unchanged", () => {
  it("GET /movements/report still prints the path it always did", async () => {
    const res = await app.get("/movements/report").set(adminH);
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: { item: { id: string } }) => r.item.id === itemId);
    expect(row).toBeTruthy();
    expect(row.location.name).toBe(fullPath);
  });

  it("filtering by a parent location still finds stock nested beneath it", async () => {
    // The subtree expansion shares the location tree with the path lookup, so
    // this guards against the two being refactored apart.
    const res = await app.get(`/movements/report?location_id=${roomId}`).set(adminH);
    expect(res.status).toBe(200);
    expect(res.body.rows.some((r: { item: { id: string } }) => r.item.id === itemId)).toBe(true);
  });
});

describe("a top-level location is just its own name", () => {
  it("has no separator", async () => {
    const res = await app.get(`/stock?location_id=${roomId}`).set(adminH);
    expect(res.status).toBe(200);
    for (const r of res.body as { locations: { name: string } }[]) {
      expect(r.locations.name.includes(SEP)).toBe(false);
    }
  });
});

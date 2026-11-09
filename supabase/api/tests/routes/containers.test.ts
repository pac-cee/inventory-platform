import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { one } from "../../src/db.js";

// Containers (0041): a box is a location with a kind, a label and a QR code.
describe("containers", () => {
  let managerH: Record<string, string>;
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  const locationIds: string[] = [];
  const itemIds: string[] = [];
  const stamp = Date.now();
  let levelId = ""; // every box sits on this level (Area > Shelf > Level > Box)

  const makeLocation = async (body: Record<string, unknown>) => {
    const res = await app.post("/locations").set(managerH).send(body);
    if (res.body?.id) locationIds.push(res.body.id);
    return res;
  };

  beforeAll(async () => {
    managerH = await authHeaders("manager");
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const area = await makeLocation({ name: `c-area-${stamp}` });
    const shelf = await makeLocation({ name: `c-shelf-${stamp}`, kind: "shelf", parent_id: area.body.id });
    levelId = (await makeLocation({ name: `c-level-${stamp}`, kind: "level", parent_id: shelf.body.id })).body.id;
  });

  afterAll(async () => {
    for (const id of itemIds) await app.delete(`/items/${id}`).set(adminH).catch(() => {});
    for (const id of [...locationIds].reverse()) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
  });

  it("an ordinary location is an 'area' with no code, so nothing existing changes", async () => {
    const res = await makeLocation({ name: `area-${stamp}` });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("area");
    expect(res.body.qr_token).toBeNull();
    expect(res.body.label).toBeNull();
  });

  it("a manager can create a box with a label, and it gets a QR code", async () => {
    const res = await makeLocation({ name: `box-${stamp}`, kind: "box", label: "USB-A to C cables", parent_id: levelId });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("box");
    expect(res.body.label).toBe("USB-A to C cables");
    expect(res.body.qr_token).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it("two boxes never share a code", async () => {
    const a = await makeLocation({ name: `box-a-${stamp}`, kind: "box", parent_id: levelId });
    const b = await makeLocation({ name: `box-b-${stamp}`, kind: "box", parent_id: levelId });
    expect(a.body.qr_token).not.toBe(b.body.qr_token);
  });

  it("converting an older place on a level to a box assigns a code, and later edits keep it", async () => {
    // Places made before kinds existed are all "area", wherever they sit; made here by SQL.
    const legacy = (
      await one<{ id: string }>("insert into locations (name, parent_id, kind) values ($1, $2, 'area') returning id", [`legacy-${stamp}`, levelId])
    ).id;
    locationIds.push(legacy);

    const converted = await app.patch(`/locations/${legacy}`).set(managerH).send({ kind: "box", label: "M3 screws" });
    expect(converted.status).toBe(200);
    expect(converted.body.kind).toBe("box");
    const code = converted.body.qr_token;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);

    // Re-labelling and re-saving as a box: the sticker already on the box keeps working.
    const relabelled = await app.patch(`/locations/${legacy}`).set(managerH).send({ kind: "box", label: "M3 and M4 screws" });
    expect(relabelled.body.qr_token).toBe(code);
    const again = await app.patch(`/locations/${legacy}`).set(managerH).send({ kind: "box" });
    expect(again.body.qr_token).toBe(code);

    // A box on a level cannot be turned into a shelf (a shelf sits in an area) — and nothing changes.
    const refused = await app.patch(`/locations/${legacy}`).set(managerH).send({ kind: "shelf" });
    expect(refused.status).toBe(422);
    expect((await app.get(`/locations/by-token/${code}`).set(memberH)).status).toBe(200);
  });

  it("a client cannot choose the code", async () => {
    const res = await makeLocation({ name: `forged-${stamp}`, kind: "box", qr_token: "AAAAAAAAAA", parent_id: levelId });
    expect(res.status).toBe(201);
    expect(res.body.qr_token).not.toBe("AAAAAAAAAA");
    const patched = await app.patch(`/locations/${res.body.id}`).set(managerH).send({ qr_token: "BBBBBBBBBB" });
    expect(patched.body.qr_token).toBe(res.body.qr_token);
  });

  it("rejects a kind that does not exist", async () => {
    const res = await makeLocation({ name: `bad-${stamp}`, kind: "crate" });
    expect(res.status).toBe(422);
  });

  it("members cannot create or convert boxes", async () => {
    expect((await app.post("/locations").set(memberH).send({ name: `m-${stamp}`, kind: "box" })).status).toBe(403);
    const loc = await makeLocation({ name: `plain-${stamp}` });
    expect((await app.patch(`/locations/${loc.body.id}`).set(memberH).send({ kind: "box" })).status).toBe(403);
  });

  describe("scanning a box", () => {
    let boxId = "";
    let code = "";
    let parentId = "";
    let itemId = "";

    beforeAll(async () => {
      const parent = await makeLocation({ name: `scan-parent-${stamp}`, kind: "level", parent_id: (await makeLocation({ name: `scan-shelf-${stamp}`, kind: "shelf", parent_id: (await makeLocation({ name: `scan-area-${stamp}` })).body.id })).body.id });
      parentId = parent.body.id;
      const box = await makeLocation({ name: `scan-box-${stamp}`, kind: "box", label: "Raspberry Pi", parent_id: parentId });
      boxId = box.body.id;
      code = box.body.qr_token;
      const item = await app.post("/items").set(managerH).send({ type: `scan-type-${stamp}`, name: `scan-item-${stamp}`, model: "M2" });
      itemId = item.body.id;
      itemIds.push(itemId);
      await app.post("/movements").set(adminH).send({ item_id: itemId, location_id: boxId, delta: 4, capacity_delta: 4, reason: "initial" });
    });

    it("any signed-in user resolves the code to the box, its path and what is inside", async () => {
      const res = await app.get(`/locations/by-token/${code}`).set(memberH);
      expect(res.status).toBe(200);
      expect(res.body.location.id).toBe(boxId);
      expect(res.body.location.label).toBe("Raspberry Pi");
      expect(res.body.path).toBe(`scan-area-${stamp} › scan-shelf-${stamp} › scan-parent-${stamp} › scan-box-${stamp}`);
      expect(res.body.contents).toHaveLength(1);
      expect(res.body.contents[0]).toMatchObject({
        item_id: itemId,
        quantity: 4,
        // The item reads as its label (type · name · model); the SKU is assigned, never typed.
        name: `scan-type-${stamp} · scan-item-${stamp} · M2`,
        type: `scan-type-${stamp}`,
        model: "M2",
        sku: expect.stringMatching(/^vrlt-/),
      });
    });

    it("is forgiving about case and spaces in the code", async () => {
      const res = await app.get(`/locations/by-token/${code.toLowerCase()}%20`).set(memberH);
      expect(res.status).toBe(200);
      expect(res.body.location.id).toBe(boxId);
    });

    it("404s a well-formed code that belongs to no box", async () => {
      expect((await app.get("/locations/by-token/0000000000").set(memberH)).status).toBe(404);
    });

    it("422s something that is not a code at all", async () => {
      expect((await app.get("/locations/by-token/nope").set(memberH)).status).toBe(422);
    });

    it("requires a signed-in user", async () => {
      expect((await app.get(`/locations/by-token/${code}`)).status).toBe(401);
    });

    it("does not list empty stock", async () => {
      const empty = await makeLocation({ name: `empty-box-${stamp}`, kind: "box", parent_id: levelId });
      const res = await app.get(`/locations/by-token/${empty.body.qr_token}`).set(memberH);
      expect(res.status).toBe(200);
      expect(res.body.contents).toEqual([]);
    });
  });
});

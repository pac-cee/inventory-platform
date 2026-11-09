import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * The condition report — the printed asset-state table: room, category, item,
 * quantity, condition, % operational, recommendation.
 *
 * The fixture below is the "HP laptop" row from the report this feature was
 * specified against, reproduced exactly:
 *
 *   Computer Laptop | HP | 28 | 12 batteries died, 1 has a booting problem,
 *   5 with RAM and hard disk problem, and 1 has a Broken screen | 32.1 %
 *
 * 12 + 1 + 5 + 1 = 19 damaged out of 28, so 9 operational = 32.1%. If the tally
 * and the percentage ever disagree, one of them is lying to whoever prints it.
 */
describe("condition report", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let roomId: string;
  let shelfId: string;
  let itemId: string;
  const stamp = Date.now();

  const FAULTS = [
    { quantity: 12, note: "batteries died", recommendation: "Replace those batteries" },
    { quantity: 1, note: "has a booting problem", recommendation: "Repair the broken" },
    { quantity: 5, note: "RAM and hard disk problem", recommendation: "Repair the broken" },
    { quantity: 1, note: "Broken screen", recommendation: "Repair the broken" },
  ];

  const fetchRow = async () => {
    const res = await app.get(`/reports/condition?item_id=${itemId}`).set(adminH);
    expect(res.status).toBe(200);
    return res.body.find((r: { location_id: string }) => r.location_id === shelfId);
  };

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    // A room with a shelf inside it — the report groups by the top-level room.
    const room = await app.post("/locations").set(adminH).send({ name: `cond-room-${stamp}` });
    roomId = room.body.id;
    const shelf = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `cond-shelf-${stamp}`, parent_id: roomId });
    shelfId = shelf.body.id;

    const item = await app
      .post("/items")
      .set(adminH)
      .send({ type: `cond-hp-${stamp}`, name: `cond-sku-${stamp}`, model: "Std", category: "Computer Laptop" });
    itemId = item.body.id;

    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: shelfId, delta: 28, reason: "initial" });

    for (const f of FAULTS) {
      const res = await app
        .post("/movements/destroy")
        .set(adminH)
        .send({ item_id: itemId, location_id: shelfId, ...f });
      expect(res.status).toBe(201);
    }
  });

  it("is admin-only", async () => {
    expect((await app.get("/reports/condition")).status).toBe(401);
    expect((await app.get("/reports/condition").set(memberH)).status).toBe(403);
  });

  it("reproduces the quantity, damage tally and % operational from the source report", async () => {
    const row = await fetchRow();
    expect(row).toBeTruthy();

    expect(row.total).toBe(28);
    expect(row.damaged).toBe(19);
    expect(row.operational).toBe(9);
    expect(Math.round((row.operational / row.total) * 1000) / 10).toBe(32.1);

    // The condition sentence is the fault list, and it must account for every
    // damaged unit — no silent remainder.
    const tally: Record<string, number> = Object.fromEntries(
      row.faults.map((f: { note: string; units: number }) => [f.note, f.units]),
    );
    expect(tally).toEqual({
      "batteries died": 12,
      "has a booting problem": 1,
      "RAM and hard disk problem": 5,
      "Broken screen": 1,
    });
    expect(row.accounted).toBe(row.damaged);

    // Biggest fault first, so the printed sentence leads with what matters.
    expect(row.faults[0].note).toBe("batteries died");
    expect(row.faults[0].recommendation).toBe("Replace those batteries");
  });

  it("groups the row under its room and category", async () => {
    const row = await fetchRow();
    expect(row.room_id).toBe(roomId);
    expect(row.room_name).toBe(`cond-room-${stamp}`);
    // The whole path, not the leaf: "cond-shelf" alone does not say which room.
    expect(row.location_name).toBe(`cond-room-${stamp} › cond-shelf-${stamp}`);
    expect(row.category).toBe("Computer Laptop");
  });

  it("counts checked-out units as operational, not missing", async () => {
    // Someone takes 4 working laptops. They still work, so the percentage must
    // not move — this is why the report divides by capacity, not quantity.
    const before = await fetchRow();
    await app
      .post("/movements/check-out")
      .set(adminH)
      .send({ item_id: itemId, location_id: shelfId, quantity: 4 });

    const after = await fetchRow();
    expect(after.total).toBe(before.total);
    expect(after.operational).toBe(before.operational);
    expect(after.in_use).toBe(4);
    expect(after.available).toBe(before.available - 4);

    await app
      .post("/movements/check-in")
      .set(adminH)
      .send({ item_id: itemId, location_id: shelfId, quantity: 4 });
  });

  it("shortens the tally when a specific fault is repaired", async () => {
    const before = await fetchRow();
    const screen = before.faults.find((f: { note: string }) => f.note === "Broken screen");

    const faults = await app
      .get(`/movements/faults?item_id=${itemId}&location_id=${shelfId}`)
      .set(adminH);
    expect(faults.status).toBe(200);
    const target = faults.body.find((f: { note: string }) => f.note === "Broken screen");
    expect(target.units).toBe(1);

    const repair = await app
      .post("/movements/repair")
      .set(adminH)
      .send({ item_id: itemId, location_id: shelfId, quantity: 1, resolves: target.id });
    expect(repair.status).toBe(201);

    const after = await fetchRow();
    expect(after.damaged).toBe(before.damaged - 1);
    expect(after.operational).toBe(before.operational + 1);
    // The fixed fault leaves the sentence entirely; the others are untouched.
    expect(after.faults.some((f: { note: string }) => f.note === "Broken screen")).toBe(false);
    expect(after.accounted).toBe(after.damaged);
    expect(screen.units).toBe(1);
  });

  it("refuses a repair that claims more units than the fault caused", async () => {
    const faults = await app
      .get(`/movements/faults?item_id=${itemId}&location_id=${shelfId}`)
      .set(adminH);
    const boot = faults.body.find((f: { note: string }) => f.note === "has a booting problem");

    const res = await app
      .post("/movements/repair")
      .set(adminH)
      .send({ item_id: itemId, location_id: shelfId, quantity: 5, resolves: boot.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("fault_overrun");
    expect(res.body.error.message).toContain("Only 1");
  });

  it("refuses a repair pointed at a fault from another location", async () => {
    const other = await app.post("/locations").set(adminH).send({ name: `cond-other-${stamp}` });
    const faults = await app
      .get(`/movements/faults?item_id=${itemId}&location_id=${shelfId}`)
      .set(adminH);

    const res = await app
      .post("/movements/repair")
      .set(adminH)
      .send({
        item_id: itemId,
        location_id: other.body.id,
        quantity: 1,
        resolves: faults.body[0].id,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("fault_mismatch");
  });

  it("filters by room, including everything nested under it", async () => {
    const inRoom = await app.get(`/reports/condition?location_id=${roomId}`).set(adminH);
    expect(inRoom.status).toBe(200);
    // The stock lives on the shelf, not the room itself, so this only returns
    // it if the filter walks down the tree.
    expect(inRoom.body.some((r: { location_id: string }) => r.location_id === shelfId)).toBe(true);

    const elsewhere = await app.get(`/reports/condition?location_id=${shelfId}`).set(adminH);
    expect(elsewhere.body.every((r: { room_id: string }) => r.room_id === roomId)).toBe(true);
  });

  it("filters by category", async () => {
    const hit = await app.get("/reports/condition?category=Computer%20Laptop").set(adminH);
    expect(hit.body.some((r: { item_id: string }) => r.item_id === itemId)).toBe(true);

    const miss = await app.get("/reports/condition?category=Cables").set(adminH);
    expect(miss.body.some((r: { item_id: string }) => r.item_id === itemId)).toBe(false);
  });

  it("faulty_only drops the rows that are entirely fine", async () => {
    const clean = await app
      .post("/items")
      .set(adminH)
      .send({ type: `cond-good-${stamp}`, name: `cond-good-${stamp}`, model: "Std", category: "Cables" });
    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: clean.body.id, location_id: shelfId, delta: 10, reason: "initial" });

    const all = await app.get(`/reports/condition?location_id=${roomId}`).set(adminH);
    expect(all.body.some((r: { item_id: string }) => r.item_id === clean.body.id)).toBe(true);

    const faulty = await app
      .get(`/reports/condition?location_id=${roomId}&faulty_only=true`)
      .set(adminH);
    expect(faulty.body.some((r: { item_id: string }) => r.item_id === clean.body.id)).toBe(false);
    expect(faulty.body.some((r: { item_id: string }) => r.item_id === itemId)).toBe(true);
  });

  it("lists the categories in use for the picker", async () => {
    const res = await app.get("/reports/categories").set(adminH);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Computer Laptop");
    expect(res.body).toContain("Cables");
  });

  it("requires a reason when marking damage", async () => {
    for (const path of ["/movements/destroy", "/movements/lost"]) {
      const missing = await app
        .post(path)
        .set(adminH)
        .send({ item_id: itemId, location_id: shelfId, quantity: 1 });
      expect(missing.status).toBe(422);

      // A single character is not a reason — the report would print "x".
      const tooShort = await app
        .post(path)
        .set(adminH)
        .send({ item_id: itemId, location_id: shelfId, quantity: 1, note: "x" });
      expect(tooShort.status).toBe(422);
    }
  });

  it("drops a fault whose damage was undone", async () => {
    const before = await fetchRow();
    const marked = await app
      .post("/movements/destroy")
      .set(adminH)
      .send({
        item_id: itemId,
        location_id: shelfId,
        quantity: 2,
        note: "recorded against the wrong machine",
      });
    expect(marked.status).toBe(201);
    expect((await fetchRow()).damaged).toBe(before.damaged + 2);

    const undone = await app.post(`/movements/${marked.body.id}/undo`).set(adminH);
    expect(undone.status).toBe(201);

    const after = await fetchRow();
    expect(after.damaged).toBe(before.damaged);
    // The mistake must not linger in the printed condition sentence.
    expect(
      after.faults.some((f: { note: string }) => f.note === "recorded against the wrong machine"),
    ).toBe(false);
    expect(after.accounted).toBe(after.damaged);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

describe("movements route", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let locationId: string;
  let itemId: string;
  let movementId: string;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    // Create a location + item to move stock between.
    const loc = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `mv-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;

    const item = await app
      .post("/items")
      .set(adminH)
      .send({
        type: `mv-item-${Date.now()}`,
        name: `mv-name-${Date.now()}`,
        model: "Std",
        price: 100,
        item_stock: [{ location_id: locationId, qty: 50, capacity: 100 }],
      });
    itemId = item.body.id;
  });

  afterAll(async () => {
    if (movementId) await app.delete(`/movements/${movementId}`).set(adminH).catch(() => {});
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.get("/movements");
    expect(res.status).toBe(401);
  });

  it("member can list movements (empty initially)", async () => {
    const res = await app.get("/movements").set(memberH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("creates a stock movement as the current user and returns it", async () => {
    const res = await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: locationId, delta: 5, reason: "take" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.item_id).toBe(itemId);
    expect(res.body.location_id).toBe(locationId);
    expect(res.body.user_id).toBeTruthy();
    movementId = res.body.id;
  });

  it("lists the created movement filtered by item", async () => {
    const res = await app.get(`/movements?item_id=${itemId}`).set(memberH);
    expect(res.status).toBe(200);
    expect(res.body.some((m: { id: string }) => m.id === movementId)).toBe(true);
  });

  it("rejects a movement with an invalid uuid item", async () => {
    const res = await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: "not-a-uuid", location_id: locationId, delta: 1, reason: "take" });
    expect(res.status).toBe(422);
  });

  // The raw ledger write takes arbitrary deltas and any reason, so leaving it
  // open to members re-opened every rule the dedicated routes enforce: the
  // admin gate on /repair, /transfer and /adjust, and the check-in ceiling.
  it("forbids members — raw ledger writes are admin-only", async () => {
    const res = await app
      .post("/movements")
      .set(memberH)
      .send({ item_id: itemId, location_id: locationId, delta: 1, reason: "take" });
    expect(res.status).toBe(403);
  });

  it("members cannot reach admin-only reasons through it", async () => {
    for (const reason of ["repair", "transfer", "adjust"]) {
      const res = await app
        .post("/movements")
        .set(memberH)
        .send({ item_id: itemId, location_id: locationId, delta: 1, reason });
      expect(res.status).toBe(403);
    }
  });

  it("members cannot bypass the check-in held-ceiling through it", async () => {
    // /movements/check-in caps a return at what the member holds; the generic
    // endpoint took the same write with no ceiling at all.
    const res = await app
      .post("/movements")
      .set(memberH)
      .send({ item_id: itemId, location_id: locationId, delta: 999, reason: "return" });
    expect(res.status).toBe(403);
  });
});

describe("POST /movements/transfer (relocate)", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let fromId: string;
  let toId: string;
  let itemId: string;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    const from = await app.post("/locations").set(adminH).send({ name: `xfer-from-${Date.now()}` });
    fromId = from.body.id;
    const to = await app.post("/locations").set(adminH).send({ name: `xfer-to-${Date.now()}` });
    toId = to.body.id;

    const item = await app
      .post("/items")
      .set(adminH)
      .send({ type: `xfer-item-${Date.now()}`, name: `xfer-${Date.now()}`, model: "Std" });
    itemId = item.body.id;

    // Seed 20 units at the source location.
    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: fromId, delta: 20, reason: "initial" });
  });

  afterAll(async () => {
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    if (fromId) await app.delete(`/locations/${fromId}`).set(adminH).catch(() => {});
    if (toId) await app.delete(`/locations/${toId}`).set(adminH).catch(() => {});
  });

  const stockAt = async (loc: string) => {
    const res = await app.get(`/items/${itemId}/stock`).set(adminH);
    return (res.body as { location_id: string; quantity: number; damaged: number; capacity: number }[]).find(
      (r) => r.location_id === loc,
    );
  };

  it("forbids members (admin-only)", async () => {
    const res = await app
      .post("/movements/transfer")
      .set(memberH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: toId });
    expect(res.status).toBe(403);
  });

  it("rejects a transfer to the same location", async () => {
    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: fromId });
    expect(res.status).toBe(422);
  });

  it("moves the ENTIRE row (accessible + damaged + total) and removes it from the source", async () => {
    // Mark 3 of the 20 as damaged first, so the source is 17 accessible / 3 damaged / 20 total.
    await app
      .post("/movements/destroy")
      .set(adminH)
      .send({ item_id: itemId, location_id: fromId, quantity: 3, note: "cracked casing" });

    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: toId });
    expect(res.status).toBe(201);

    // Source is gone entirely; destination holds the whole thing, total intact.
    const src = await stockAt(fromId);
    const dst = await stockAt(toId);
    expect(src).toBeUndefined();
    expect(dst?.quantity).toBe(17);
    expect(dst?.damaged).toBe(3);
    expect(dst?.capacity).toBe(20);
  });

  it("rejects moving from a location with nothing there", async () => {
    // Source was already emptied by the previous test.
    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: toId });
    expect(res.status).toBe(422);
  });

  // ── Report filtering ────────────────────────────────────────────────────
  // By this point the item has an 'initial', a 'destroyed' and two 'transfer'
  // entries, so it exercises both a matching and a non-matching filter.

  it("report can filter by reason=transfer", async () => {
    // 'transfer' was missing from the allow-list, so the filter matched nothing
    // and was then dropped entirely — returning EVERY movement instead.
    const res = await app
      .get(`/movements/report?item_id=${itemId}&reason=transfer`)
      .set(adminH);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    const reasons = res.body.rows.map((r: { reason: string }) => r.reason);
    expect(new Set(reasons)).toEqual(new Set(["transfer"]));
  });

  it("report returns nothing when no requested reason is recognised", async () => {
    const res = await app
      .get(`/movements/report?item_id=${itemId}&reason=not-a-reason`)
      .set(adminH);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.rows).toEqual([]);
  });

  it("report still honours a multi-reason filter", async () => {
    const res = await app
      .get(`/movements/report?item_id=${itemId}&reason=transfer,initial`)
      .set(adminH);
    expect(res.status).toBe(200);
    const reasons = new Set(res.body.rows.map((r: { reason: string }) => r.reason));
    expect(reasons.has("transfer")).toBe(true);
    expect(reasons.has("destroyed")).toBe(false);
  });
});

describe("members can only act where an item is registered", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let stockedId: string;
  let emptyId: string;
  let itemId: string;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    const stamp = Date.now();
    stockedId = (await app.post("/locations").set(adminH).send({ name: `reg-yes-${stamp}` })).body.id;
    emptyId = (await app.post("/locations").set(adminH).send({ name: `reg-no-${stamp}` })).body.id;

    const item = await app
      .post("/items")
      .set(adminH)
      .send({ type: `reg-item-${stamp}`, name: `reg-${stamp}`, model: "Std" });
    itemId = item.body.id as string;
    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: stockedId, delta: 10, reason: "initial" });
  });

  afterAll(async () => {
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    for (const id of [stockedId, emptyId]) {
      await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
    }
  });

  it("lets a member take from a location where it IS registered", async () => {
    const res = await app
      .post("/movements/check-out")
      .set(memberH)
      .send({ item_id: itemId, location_id: stockedId, quantity: 2 });
    expect(res.status).toBe(201);
  });

  it("refuses a member returning stock to a location it was never registered at", async () => {
    // Without this the stock trigger would happily invent a balance row there,
    // stocking the item somewhere no admin ever put it.
    const res = await app
      .post("/movements/check-in")
      .set(memberH)
      .send({ item_id: itemId, location_id: emptyId, quantity: 1, note: "cracked casing" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("not_registered_here");

    const stock = await app.get(`/items/${itemId}/stock`).set(adminH);
    expect((stock.body as { location_id: string }[]).some((r) => r.location_id === emptyId)).toBe(false);
  });

  it("refuses a member marking it damaged or lost somewhere it isn't registered", async () => {
    for (const path of ["/movements/destroy", "/movements/lost"]) {
      const res = await app
        .post(path)
        .set(memberH)
        .send({ item_id: itemId, location_id: emptyId, quantity: 1, note: "cracked casing" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("not_registered_here");
    }
  });

  it("still lets an admin register it at a new location", async () => {
    const res = await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: emptyId, delta: 5, reason: "initial" });
    expect(res.status).toBe(201);

    // ...and the member can now use that location.
    const member = await app
      .post("/movements/check-out")
      .set(memberH)
      .send({ item_id: itemId, location_id: emptyId, quantity: 1, note: "cracked casing" });
    expect(member.status).toBe(201);
  });
});

describe("returning to a different location keeps the grand total", () => {
  let adminH: Record<string, string>;
  let fromId: string;
  let toId: string;
  let itemId: string;

  const totals = async () => {
    const res = await app.get(`/items/${itemId}/stock`).set(adminH);
    const list = res.body as { location_id: string; quantity: number; capacity: number }[];
    return {
      grandTotal: list.reduce((s, r) => s + r.capacity, 0),
      at: (loc: string) => list.find((r) => r.location_id === loc),
    };
  };

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    const stamp = Date.now();
    fromId = (await app.post("/locations").set(adminH).send({ name: `back-from-${stamp}` })).body.id;
    toId = (await app.post("/locations").set(adminH).send({ name: `back-to-${stamp}` })).body.id;

    const item = await app
      .post("/items")
      .set(adminH)
      .send({ type: `back-item-${stamp}`, name: `back-${stamp}`, model: "Std" });
    itemId = item.body.id as string;
    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: fromId, delta: 10, reason: "initial" });
  });

  afterAll(async () => {
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    for (const id of [fromId, toId]) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
  });

  it("hands the total over instead of inventing units", async () => {
    const before = await totals();
    expect(before.grandTotal).toBe(10);

    // Take 4 from the source. Its total is unchanged — the units still belong
    // there, they're just checked out.
    await app
      .post("/movements/check-out")
      .set(adminH)
      .send({ item_id: itemId, location_id: fromId, quantity: 4 });
    const afterTake = await totals();
    expect(afterTake.grandTotal).toBe(10);
    expect(afterTake.at(fromId)?.quantity).toBe(6);
    expect(afterTake.at(fromId)?.capacity).toBe(10);

    // Return them somewhere else entirely.
    const res = await app
      .post("/movements/check-in")
      .set(adminH)
      .send({ item_id: itemId, location_id: toId, quantity: 4 });
    expect(res.status).toBe(201);

    const after = await totals();
    // Still ten units in the world — the 4 moved across rather than doubling.
    expect(after.grandTotal).toBe(10);
    expect(after.at(fromId)?.capacity).toBe(6);
    expect(after.at(toId)?.quantity).toBe(4);
    expect(after.at(toId)?.capacity).toBe(4);
  });

  it("leaves the total alone when returning where it came from", async () => {
    await app
      .post("/movements/check-out")
      .set(adminH)
      .send({ item_id: itemId, location_id: toId, quantity: 2 });
    await app
      .post("/movements/check-in")
      .set(adminH)
      .send({ item_id: itemId, location_id: toId, quantity: 2 });

    const after = await totals();
    expect(after.grandTotal).toBe(10);
    expect(after.at(toId)?.quantity).toBe(4);
    expect(after.at(toId)?.capacity).toBe(4);
  });

  it("never leaves a location with more accessible than its total", async () => {
    const res = await app.get(`/items/${itemId}/stock`).set(adminH);
    for (const r of res.body as { quantity: number; damaged: number; capacity: number }[]) {
      expect(r.quantity + r.damaged).toBeLessThanOrEqual(r.capacity);
    }
  });
});

describe("POST /movements/transfer — moving part of what's there", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let fromId: string;
  let toId: string;
  let itemId: string;

  const rowsFor = async () => {
    const res = await app.get(`/items/${itemId}/stock`).set(adminH);
    const list = res.body as {
      location_id: string;
      quantity: number;
      damaged: number;
      capacity: number;
    }[];
    return { total: list.reduce((s, r) => s + r.capacity, 0), at: (l: string) => list.find((r) => r.location_id === l) };
  };

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const stamp = Date.now();
    fromId = (await app.post("/locations").set(adminH).send({ name: `part-from-${stamp}` })).body.id;
    toId = (await app.post("/locations").set(adminH).send({ name: `part-to-${stamp}` })).body.id;
    const item = await app
      .post("/items")
      .set(adminH)
      .send({ type: `part-item-${stamp}`, name: `part-${stamp}`, model: "Std" });
    itemId = item.body.id as string;
    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemId, location_id: fromId, delta: 12, reason: "initial" });
  });

  afterAll(async () => {
    if (itemId) await app.delete(`/items/${itemId}`).set(adminH).catch(() => {});
    for (const id of [fromId, toId]) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
  });

  it("moves exactly the requested units and keeps the grand total", async () => {
    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: toId, quantity: 5 });
    expect(res.status).toBe(201);

    const after = await rowsFor();
    expect(after.total).toBe(12);
    expect(after.at(fromId)?.quantity).toBe(7);
    expect(after.at(fromId)?.capacity).toBe(7);
    expect(after.at(toId)?.quantity).toBe(5);
    expect(after.at(toId)?.capacity).toBe(5);
  });

  it("won't move more than is on the shelf", async () => {
    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: toId, quantity: 99 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("not_enough_to_move");
    expect((await rowsFor()).total).toBe(12);
  });

  it("leaves damaged units and checked-out units where they are", async () => {
    // 7 on the shelf at the source: damage 2 and check 1 out, leaving 4 movable.
    await app
      .post("/movements/destroy")
      .set(adminH)
      .send({ item_id: itemId, location_id: fromId, quantity: 2, note: "cracked casing" });
    await app
      .post("/movements/check-out")
      .set(adminH)
      .send({ item_id: itemId, location_id: fromId, quantity: 1 });

    const tooMany = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: toId, quantity: 5 });
    expect(tooMany.status).toBe(422);

    const ok = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_id: itemId, from_location_id: fromId, to_location_id: toId, quantity: 4 });
    expect(ok.status).toBe(201);

    const after = await rowsFor();
    expect(after.total).toBe(12);
    // The 2 damaged and the 1 checked out still belong to the source.
    expect(after.at(fromId)?.quantity).toBe(0);
    expect(after.at(fromId)?.damaged).toBe(2);
    expect(after.at(fromId)?.capacity).toBe(3);
  });

  it("is admin-only, and rejects a partial move of a batch", async () => {
    const forbidden = await app
      .post("/movements/transfer")
      .set(memberH)
      .send({ item_id: itemId, from_location_id: toId, to_location_id: fromId, quantity: 1 });
    expect(forbidden.status).toBe(403);

    const batch = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_ids: [itemId], from_location_id: toId, to_location_id: fromId, quantity: 1 });
    expect(batch.status).toBe(422);
  });
});

describe("POST /movements/transfer — several items at once", () => {
  let adminH: Record<string, string>;
  let fromId: string;
  let toId: string;
  const itemIds: string[] = [];

  beforeAll(async () => {
    adminH = await authHeaders("admin");

    const stamp = Date.now();
    fromId = (await app.post("/locations").set(adminH).send({ name: `bulk-from-${stamp}` })).body.id;
    toId = (await app.post("/locations").set(adminH).send({ name: `bulk-to-${stamp}` })).body.id;

    for (const n of [1, 2, 3]) {
      const item = await app
        .post("/items")
        .set(adminH)
        .send({ type: `bulk-item-${n}-${stamp}`, name: `bulk-${n}-${stamp}`, model: "Std" });
      itemIds.push(item.body.id as string);
      await app
        .post("/movements")
        .set(adminH)
        .send({ item_id: item.body.id, location_id: fromId, delta: n * 5, reason: "initial" });
    }
  });

  afterAll(async () => {
    for (const id of itemIds) await app.delete(`/items/${id}`).set(adminH).catch(() => {});
    for (const id of [fromId, toId]) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
  });

  const stockAt = async (itemId: string, loc: string) => {
    const res = await app.get(`/items/${itemId}/stock`).set(adminH);
    return (res.body as { location_id: string; quantity: number }[]).find(
      (r) => r.location_id === loc,
    );
  };

  it("moves every selected item in one call and empties the source", async () => {
    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_ids: itemIds, from_location_id: fromId, to_location_id: toId });

    expect(res.status).toBe(201);
    expect(res.body.moved).toBe(3);
    expect(res.body.failed).toEqual([]);

    for (const [i, id] of itemIds.entries()) {
      expect(await stockAt(id, fromId)).toBeUndefined();
      expect((await stockAt(id, toId))?.quantity).toBe((i + 1) * 5);
    }
  });

  it("reports per-item failures without rolling back the ones that worked", async () => {
    // Put only the first item back at the source; the other two have nothing
    // there any more, so they must fail individually.
    await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: itemIds[0], location_id: fromId, delta: 2, reason: "initial" });

    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_ids: itemIds, from_location_id: fromId, to_location_id: toId });

    expect(res.status).toBe(201);
    expect(res.body.moved).toBe(1);
    expect(res.body.failed).toHaveLength(2);
    expect(await stockAt(itemIds[0], fromId)).toBeUndefined();
  });

  it("errors when nothing in the batch could move", async () => {
    const res = await app
      .post("/movements/transfer")
      .set(adminH)
      .send({ item_ids: itemIds, from_location_id: fromId, to_location_id: toId });
    expect(res.status).toBe(422);
  });
});

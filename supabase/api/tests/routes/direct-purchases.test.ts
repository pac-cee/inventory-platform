import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";

// Purchases made outside the payment flow (petty cash). They must be recorded in
// full, stock only what is meant to be stock, and never touch the payments tables.
describe("direct purchases", () => {
  let adminH: Record<string, string>;
  let managerH: Record<string, string>;
  let memberH: Record<string, string>;
  const stamp = Date.now();
  const vendorName = `Test Vendor ${stamp}`;
  const purchaseIds: string[] = [];
  const itemIds: string[] = [];
  let locationId: string;

  const body = (over: Record<string, unknown> = {}) => ({
    purchased_on: "2026-10-24",
    vendor_name: vendorName,
    category: `Office Supplies ${stamp}`,
    justification: "drinking water for the office",
    purchased_by_name: "Darius",
    paid_by_name: "Herve",
    receipt_ref: "45659/45660NS",
    lines: [{ description: "jib water", quantity: 8, unit_cost: 2500 }],
    ...over,
  });
  const create = async (over: Record<string, unknown> = {}, h = managerH) => {
    const res = await app.post("/direct-purchases").set(h).send(body(over));
    if (res.body?.id) purchaseIds.push(res.body.id);
    return res;
  };

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    managerH = await authHeaders("manager");
    memberH = await authHeaders("member");
    const loc = await app.post("/locations").set(adminH).send({ name: `dp-loc-${stamp}`, description: "test" });
    locationId = loc.body.id;
  });

  afterAll(async () => {
    for (const id of purchaseIds) await exec("delete from direct_purchases where id = $1", [id]).catch(() => {});
    await exec("delete from vendors where name like $1", [`%${stamp}%`]).catch(() => {});
    for (const id of itemIds) await app.delete(`/items/${id}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  describe("who may use it", () => {
    it("a plain member cannot record or read purchases", async () => {
      expect((await app.post("/direct-purchases").set(memberH).send(body())).status).toBe(403);
      expect((await app.get("/direct-purchases").set(memberH)).status).toBe(403);
      expect((await app.get("/direct-purchases/export").set(memberH)).status).toBe(403);
    });
    it("needs a signed-in user", async () => {
      expect((await app.get("/direct-purchases")).status).toBe(401);
    });
    it("a stock manager and an admin both can", async () => {
      expect((await create({}, managerH)).status).toBe(201);
      expect((await create({}, adminH)).status).toBe(201);
    });
  });

  describe("recording a consumable", () => {
    it("computes the totals itself and creates the vendor", async () => {
      const res = await create({
        lines: [
          { description: "jib water", quantity: 8, unit_cost: 2500 },
          { description: "toilet paper", quantity: 1, unit_cost: 3500 },
        ],
        delivery_cost: 1000,
      });
      expect(res.status).toBe(201);
      expect(res.body.subtotal).toBe(23500);
      expect(res.body.delivery_cost).toBe(1000);
      expect(res.body.total).toBe(24500);
      expect(res.body.vendor_name).toBe(vendorName);
      expect(res.body.payment_method).toBe("petty_cash");
      expect(res.body.source).toBe("app");
      expect(res.body.lines).toHaveLength(2);
      expect(res.body.lines[0]).toMatchObject({ description: "jib water", total: 20000, stock_in: false });
    });

    it("adds no stock and creates no item", async () => {
      const before = await maybeOne<{ n: number }>("select count(*)::int as n from stock_movements where note like 'Direct purchase%'");
      const res = await create({ lines: [{ description: "markers", quantity: 6, unit_cost: 1000 }] });
      expect(res.body.lines[0].item_id).toBeNull();
      const after = await maybeOne<{ n: number }>("select count(*)::int as n from stock_movements where note like 'Direct purchase%'");
      expect(after!.n).toBe(before!.n);
    });

    it("never touches the payments tables or the budget", async () => {
      const tx0 = await maybeOne<{ n: number }>("select count(*)::int as n from corporate_transactions");
      const b0 = await maybeOne<{ s: string }>("select coalesce(sum(remaining_amount),0)::text as s from monthly_budgets");
      await create();
      const tx1 = await maybeOne<{ n: number }>("select count(*)::int as n from corporate_transactions");
      const b1 = await maybeOne<{ s: string }>("select coalesce(sum(remaining_amount),0)::text as s from monthly_budgets");
      expect(tx1!.n).toBe(tx0!.n);
      expect(b1!.s).toBe(b0!.s);
    });
  });

  describe("recording stock", () => {
    const stocked = (extra: Record<string, unknown> = {}) => ({
      category: `Hardware / Tools ${stamp}`,
      justification: "network setup",
      lines: [
        { description: "RJ-45 connectors", quantity: 50, unit_cost: 94.4, stock_in: true, location_id: locationId, item_type: `Connector ${stamp}`, item_name: `RJ-45 ${stamp}`, item_model: "Cat6" },
      ],
      ...extra,
    });

    it("a stocked line creates the item and puts the units in the location", async () => {
      const res = await create(stocked());
      expect(res.status).toBe(201);
      const line = res.body.lines[0];
      expect(line.stock_in).toBe(true);
      expect(line.total).toBe(4720);
      expect(line.item_id).toBeTruthy();
      itemIds.push(line.item_id);
      const stock = await maybeOne<{ quantity: number }>("select quantity from item_stock where item_id = $1 and location_id = $2", [line.item_id, locationId]);
      expect(stock?.quantity).toBe(50);
    });

    it("buying the same thing again tops up the SAME item", async () => {
      const first = await create(stocked());
      const second = await create(stocked());
      expect(second.body.lines[0].item_id).toBe(first.body.lines[0].item_id);
      const stock = await maybeOne<{ quantity: number }>("select quantity from item_stock where item_id = $1 and location_id = $2", [first.body.lines[0].item_id, locationId]);
      expect(stock!.quantity).toBeGreaterThanOrEqual(100);
    });

    it("one purchase can mix stock and consumables", async () => {
      const res = await create(
        stocked({
          lines: [
            { description: "pin headers", quantity: 30, unit_cost: 472, stock_in: true, location_id: locationId, item_type: `Header ${stamp}` },
            { description: "tape", quantity: 2, unit_cost: 2000 },
          ],
        }),
      );
      expect(res.status).toBe(201);
      itemIds.push(res.body.lines[0].item_id);
      expect(res.body.lines.map((l: any) => l.stock_in)).toEqual([true, false]);
      expect(res.body.total).toBe(30 * 472 + 4000);
    });

    it("a stocked line must say where the stock goes and what it is", async () => {
      const noWhere = await create(stocked({ lines: [{ description: "x", quantity: 1, unit_cost: 1, stock_in: true, item_type: "Cable" }] }));
      expect(noWhere.status).toBe(422);
      const noWhat = await create(stocked({ lines: [{ description: "x", quantity: 1, unit_cost: 1, stock_in: true, location_id: locationId }] }));
      expect(noWhat.status).toBe(422);
      const badLoc = await create(stocked({ lines: [{ description: "x", quantity: 1, unit_cost: 1, stock_in: true, location_id: "00000000-0000-4000-8000-000000000000", item_type: "Cable" }] }));
      expect(badLoc.status).toBe(404);
    });

    it("a failed purchase stocks nothing", async () => {
      const before = await maybeOne<{ n: number }>("select count(*)::int as n from direct_purchases");
      const res = await create(stocked({ vendor_id: "00000000-0000-4000-8000-000000000000", vendor_name: undefined }));
      expect(res.status).toBe(404);
      const after = await maybeOne<{ n: number }>("select count(*)::int as n from direct_purchases");
      expect(after!.n).toBe(before!.n);
    });
  });

  describe("validation", () => {
    it("rejects what the spreadsheet let through", async () => {
      expect((await create({ justification: "" })).status).toBe(422); // no reason given
      expect((await create({ justification: undefined })).status).toBe(422);
      expect((await create({ purchased_on: "46183" })).body.error?.code ?? "").not.toBe("");
      expect((await create({ purchased_on: "46183" })).status).toBe(422); // an Excel serial number
      expect((await create({ purchased_on: "2099-01-01" })).status).toBe(422);
      expect((await create({ purchased_on: "2026-02-30" })).status).toBe(422);
      expect((await create({ vendor_name: undefined })).status).toBe(422);
      expect((await create({ lines: [] })).status).toBe(422);
      expect((await create({ lines: [{ description: "x", quantity: 0, unit_cost: 5 }] })).status).toBe(422);
      expect((await create({ lines: [{ description: "x", quantity: 1, unit_cost: -5 }] })).status).toBe(422);
      expect((await create({ lines: [{ description: "x", quantity: 1.5, unit_cost: 5 }] })).status).toBe(422);
      expect((await create({ payment_method: "bitcoin" })).status).toBe(422);
      expect((await create({ delivery_cost: -1 })).status).toBe(422);
    });
  });

  describe("vendors", () => {
    it("the same supplier typed differently is ONE vendor", async () => {
      const a = await app.post("/direct-purchases/vendors").set(managerH).send({ name: `Atlas${stamp} M&U Ltd` });
      const b = await app.post("/direct-purchases/vendors").set(managerH).send({ name: `atlas${stamp} m&u limited` });
      expect(a.status).toBe(201);
      expect(b.status).toBe(200);
      expect(b.body.created).toBe(false);
      expect(b.body.id).toBe(a.body.id);
    });

    it("two purchases from 'different spellings' land on one vendor", async () => {
      const one = await create({ vendor_name: `Hills Electronics ${stamp}` });
      const two = await create({ vendor_name: `hills-electronics ${stamp}` });
      expect(two.body.vendor_id).toBe(one.body.vendor_id);
    });

    it("suggests the likely duplicate for a misspelling instead of silently adding a fourth", async () => {
      await app.post("/direct-purchases/vendors").set(managerH).send({ name: `Nyereka Tech ${stamp}` });
      const s = await app.get("/direct-purchases/vendors/suggest").query({ name: `Nyereka teck ${stamp}` }).set(managerH);
      expect(s.status).toBe(200);
      expect(s.body.exact).toBeNull();
      expect(s.body.similar.map((v: any) => v.name)).toContain(`Nyereka Tech ${stamp}`);
    });

    it("lists vendors with how many purchases each has", async () => {
      const list = await app.get("/direct-purchases/vendors").set(managerH);
      const mine = list.body.find((v: any) => v.name === vendorName);
      expect(mine.purchases).toBeGreaterThan(0);
    });
  });

  describe("reading", () => {
    it("filters by date, vendor and text; newest first", async () => {
      const v = `Filter Vendor ${stamp}`;
      const old = await create({ vendor_name: v, purchased_on: "2026-09-01", receipt_ref: `OLD-${stamp}` });
      const recent = await create({ vendor_name: v, purchased_on: "2026-10-20", receipt_ref: `NEW-${stamp}` });
      const byVendor = await app.get("/direct-purchases").query({ vendor_id: old.body.vendor_id }).set(managerH);
      expect(byVendor.body.map((p: any) => p.id)).toEqual([recent.body.id, old.body.id]);
      const ranged = await app.get("/direct-purchases").query({ vendor_id: old.body.vendor_id, from: "2026-10-01" }).set(managerH);
      expect(ranged.body.map((p: any) => p.id)).toEqual([recent.body.id]);
      const byReceipt = await app.get("/direct-purchases").query({ q: `OLD-${stamp}` }).set(managerH);
      expect(byReceipt.body.map((p: any) => p.id)).toEqual([old.body.id]);
    });

    it("gets one, and 404s an unknown one", async () => {
      const p = await create();
      expect((await app.get(`/direct-purchases/${p.body.id}`).set(managerH)).body.id).toBe(p.body.id);
      expect((await app.get("/direct-purchases/00000000-0000-4000-8000-000000000000").set(managerH)).status).toBe(404);
    });

    it("summarises by category, vendor and month, and splits stock from consumables", async () => {
      const v = `Summary Vendor ${stamp}`;
      const a = await create({
        vendor_name: v,
        category: `Cat A ${stamp}`,
        purchased_on: "2026-08-10",
        delivery_cost: 500,
        lines: [{ description: "paper", quantity: 2, unit_cost: 1000 }],
      });
      await create({
        vendor_name: v,
        category: `Cat B ${stamp}`,
        purchased_on: "2026-09-10",
        lines: [{ description: "board", quantity: 1, unit_cost: 7000, stock_in: true, location_id: locationId, item_type: `Board ${stamp}` }],
      }).then((r) => itemIds.push(r.body.lines[0].item_id));
      const sum = await app.get("/direct-purchases/summary").query({ vendor_id: a.body.vendor_id }).set(managerH);
      expect(sum.status).toBe(200);
      expect(sum.body.purchases).toBe(2);
      expect(sum.body.total).toBe(2000 + 500 + 7000);
      expect(sum.body.consumable_lines_total).toBe(2000);
      expect(sum.body.stock_lines_total).toBe(7000);
      expect(sum.body.by_category.map((c: any) => [c.name, c.total]).sort()).toEqual(
        [[`Cat A ${stamp}`, 2500], [`Cat B ${stamp}`, 7000]].sort(),
      );
      expect(sum.body.by_month.map((m: any) => m.month)).toEqual(["2026-08", "2026-09"]);
    });
  });

  describe("CSV export", () => {
    it("uses the finance sheet's columns, one row per line, delivery once, and defuses formulas", async () => {
      const v = `Export Vendor ${stamp}`;
      const p = await create({
        vendor_name: v,
        delivery_cost: 1500,
        justification: '=HYPERLINK("http://evil")',
        lines: [
          { description: "cable, long", quantity: 2, unit_cost: 1000 },
          { description: "plug", quantity: 3, unit_cost: 500 },
        ],
      });
      const res = await app.get("/direct-purchases/export").query({ vendor_id: p.body.vendor_id }).set(managerH);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="direct-purchases-/);
      const text = res.text.replace(/^﻿/, "");
      const lines = text.trim().split("\r\n");
      expect(lines[0]).toBe(
        "Purchase Date,Item Description,Category,Justification / Purpose,Purchased By,Vendor / Source,Quantity,Unit Cost (RWF),Total Cost (RWF),Delivery Cost,Who Paid,Payment Method,Receipt / Invoice Reference,Status / Notes,Stock",
      );
      expect(lines).toHaveLength(3); // header + 2 lines
      expect(lines[1]).toContain('"cable, long"');
      expect(lines[1]).toContain(",2000,1500,"); // total 2000, delivery on the FIRST line only
      expect(lines[2]).toContain(",1500,,"); // second line: total 1500, no delivery repeated
      expect(lines[1]).toContain("\"'=HYPERLINK("); // the formula is neutralised
      expect(lines[1]).toContain("Consumable (not stocked)");
    });
  });

  describe("voiding", () => {
    it("a mistaken consumable purchase is voided with a reason, hidden by default, kept on record", async () => {
      const p = await create();
      const noReason = await app.post(`/direct-purchases/${p.body.id}/void`).set(managerH).send({});
      expect(noReason.status).toBe(422);
      const voided = await app.post(`/direct-purchases/${p.body.id}/void`).set(managerH).send({ reason: "entered twice" });
      expect(voided.status).toBe(200);
      expect(voided.body.voided_at).toBeTruthy();
      expect(voided.body.void_reason).toBe("entered twice");
      const hidden = await app.get("/direct-purchases").query({ vendor_id: p.body.vendor_id }).set(managerH);
      expect(hidden.body.find((x: any) => x.id === p.body.id)).toBeUndefined();
      const shown = await app.get("/direct-purchases").query({ vendor_id: p.body.vendor_id, include_voided: "true" }).set(managerH);
      expect(shown.body.find((x: any) => x.id === p.body.id)).toBeTruthy();
      expect((await app.post(`/direct-purchases/${p.body.id}/void`).set(managerH).send({ reason: "again" })).status).toBe(409);
    });

    it("a purchase that added stock cannot be voided until the stock is undone", async () => {
      const p = await create({
        lines: [{ description: "board", quantity: 1, unit_cost: 100, stock_in: true, location_id: locationId, item_type: `Void Board ${stamp}` }],
      });
      itemIds.push(p.body.lines[0].item_id);
      const res = await app.post(`/direct-purchases/${p.body.id}/void`).set(managerH).send({ reason: "wrong item" });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("has_stock");
    });

    it("a member cannot void", async () => {
      const p = await create();
      expect((await app.post(`/direct-purchases/${p.body.id}/void`).set(memberH).send({ reason: "nope nope" })).status).toBe(403);
    });
  });
});

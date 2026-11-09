import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock the mailer so we assert an alert WOULD be sent (no real email in tests).
vi.mock("../../src/lib/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendVerificationEmail: vi.fn(async () => {}),
  sendLowStockAlert: vi.fn(async () => {}),
}));
import { sendLowStockAlert } from "../../src/lib/mailer.js";

import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, rows } from "../../src/db.js";

const LOC = "loc-lowstock-e4";
const LOW_ITEM = "item-low-e4";
const OK_ITEM = "item-ok-e4";

describe("low-stock alerts (E4)", () => {
  beforeAll(async () => {
    await exec("insert into locations (name) values ($1) on conflict do nothing", [LOC]);
    // Inserted directly rather than through POST /items: since 0039 type,
    // name, model and sku are all NOT NULL, so all four have to be given.
    await exec(
      "insert into items (sku, type, name, model) values ($1, $2, $3, 'Std') on conflict do nothing",
      ["vrlt-lowe4-001", LOW_ITEM, "LOW-E4"],
    );
    await exec(
      "insert into items (sku, type, name, model) values ($1, $2, $3, 'Std') on conflict do nothing",
      ["vrlt-oke4-001", OK_ITEM, "OK-E4"],
    );
    const loc = await rows<{ id: string }>("select id from locations where name = $1", [LOC]);
    const low = await rows<{ id: string }>("select id from items where type = $1", [LOW_ITEM]);
    const ok = await rows<{ id: string }>("select id from items where type = $1", [OK_ITEM]);
    const locId = loc[0].id;
    const lowId = low[0].id;
    const okId = ok[0].id;
    // low: 10/100 (10% <= 25% threshold); ok: 80/100 (80% > 25%)
    await exec(
      "insert into item_stock (item_id, location_id, quantity, capacity) values ($1,$2,10,100) on conflict do nothing",
      [lowId, locId],
    );
    await exec(
      "insert into item_stock (item_id, location_id, quantity, capacity) values ($1,$2,80,100) on conflict do nothing",
      [okId, locId],
    );
  });

  afterAll(async () => {
    await exec("delete from item_stock where location_id = (select id from locations where name = $1)", [LOC]);
    await exec("delete from low_stock_alerts where item_id in (select id from items where name in ($1,$2))", [LOW_ITEM, OK_ITEM]);
    await exec("delete from items where name in ($1,$2)", [LOW_ITEM, OK_ITEM]);
    await exec("delete from locations where name = $1", [LOC]);
  });

  it("GET /admin/low-stock is admin-only (member gets 403)", async () => {
    const res = await app.get("/admin/low-stock").set(await authHeaders("member"));
    expect(res.status).toBe(403);
  });

  it("GET /admin/low-stock lists only the low item", async () => {
    const res = await app.get("/admin/low-stock").set(await authHeaders("admin"));
    expect(res.status).toBe(200);
    // LOW_ITEM/OK_ITEM are item TYPES since 0039; item_name is its own field.
    const types = res.body.map((r: any) => r.item_type);
    expect(types).toContain(LOW_ITEM);
    expect(types).not.toContain(OK_ITEM);
  });

  it("POST /admin/check-low-stock alerts admins once, then is a no-op on re-run", async () => {
    const first = await app.post("/admin/check-low-stock").set(await authHeaders("admin"));
    expect(first.status).toBe(200);
    expect(first.body.alerted).toBe(1);
    expect(first.body.items[0].item_type).toBe(LOW_ITEM);
    expect(sendLowStockAlert).toHaveBeenCalledTimes(1);

    const second = await app.post("/admin/check-low-stock").set(await authHeaders("admin"));
    expect(second.status).toBe(200);
    expect(second.body.alerted).toBe(0); // already alerted — no spam
  });
});

/**
 * A send failure used to propagate out of the scan loop: the endpoint 500'd and
 * every item after the failing one was silently never reported.
 */
describe("low-stock alert delivery failures (E4)", () => {
  const LOC2 = "loc-lowstock-fail-e4";
  const ITEM_A = "item-fail-a-e4";
  const ITEM_B = "item-fail-b-e4";

  beforeAll(async () => {
    await exec("insert into locations (name) values ($1) on conflict do nothing", [LOC2]);
    for (const [name, type] of [["FAIL-A-E4", ITEM_A], ["FAIL-B-E4", ITEM_B]]) {
      await exec(
        "insert into items (sku, type, name, model) values ($1, $2, $3, 'Std') on conflict do nothing",
        [`vrlt-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-001`, type, name],
      );
    }
    const loc = await rows<{ id: string }>("select id from locations where name = $1", [LOC2]);
    for (const type of [ITEM_A, ITEM_B]) {
      const item = await rows<{ id: string }>("select id from items where type = $1", [type]);
      await exec(
        "insert into item_stock (item_id, location_id, quantity, capacity) values ($1,$2,5,100) on conflict do nothing",
        [item[0].id, loc[0].id],
      );
    }
  });

  afterAll(async () => {
    await exec("delete from item_stock where location_id = (select id from locations where name = $1)", [LOC2]);
    await exec("delete from low_stock_alerts where item_id in (select id from items where name in ($1,$2))", [ITEM_A, ITEM_B]);
    await exec("delete from items where name in ($1,$2)", [ITEM_A, ITEM_B]);
    await exec("delete from locations where name = $1", [LOC2]);
  });

  it("keeps scanning when one item's alert fails, and retries it next run", async () => {
    const send = sendLowStockAlert as unknown as ReturnType<typeof vi.fn>;
    // Fail every send for ITEM_A regardless of how many admins are on file, so
    // it is genuinely undelivered rather than partially delivered.
    // The alert names the item as "<type> <name> (<sku>)", so match the type
    // at the front rather than comparing the whole string.
    send.mockImplementation(async ({ itemName }: { itemName: string }) => {
      if (itemName.startsWith(ITEM_A)) throw new Error("Resend: domain not verified");
    });

    const first = await app.post("/admin/check-low-stock").set(await authHeaders("admin"));
    expect(first.status).toBe(200); // not a 500 — the scan absorbed the failure
    const alerted = first.body.items.map((r: { item_type: string }) => r.item_type);
    // ITEM_A could not be delivered; ITEM_B, scanned after it, still went out.
    expect(alerted).not.toContain(ITEM_A);
    expect(alerted).toContain(ITEM_B);
    expect(first.body.failed).toBeGreaterThanOrEqual(1);

    // Undelivered items are not recorded as alerted, so a later scan retries
    // them — once the mail path recovers they finally get through.
    send.mockImplementation(async () => {});
    const second = await app.post("/admin/check-low-stock").set(await authHeaders("admin"));
    expect(second.status).toBe(200);
    expect(second.body.items.map((r: { item_type: string }) => r.item_type)).toContain(ITEM_A);
    expect(second.body.failed).toBe(0);
  });
});

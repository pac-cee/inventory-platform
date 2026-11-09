import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";

// POST /payments/request keeps the recipient's name only for a BK payment to a phone.
describe("payment request — recipient name", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let locationId: string;
  const created: string[] = [];

  const request = async (extra: Record<string, unknown>) => {
    const res = await app
      .post("/payments/request")
      .set(memberH)
      .send({ amount: 500, location_id: locationId, products: [{ name: "Gadget", quantity: 1, price: 500 }], ...extra });
    if (res.body.transactionId) created.push(res.body.transactionId);
    return res;
  };
  const stored = async (id: string) =>
    (await maybeOne<{ recipient_name: string | null }>("select recipient_name from corporate_transactions where id = $1", [id]))
      ?.recipient_name;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const loc = await app.post("/locations").set(adminH).send({ name: `rn-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    await exec("update profiles set has_payment_permission = true where id = $1", [me.body.user.id]);
  });
  afterAll(async () => {
    for (const id of created) await app.delete(`/payments/${id}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  it("stores the (trimmed) name on a BK payment to a phone", async () => {
    const res = await request({ payment_method: "bk", recipient_phone: "0788123456", recipient_name: "  Amina Uwase " });
    expect(res.status).toBe(200);
    expect(await stored(res.body.transactionId)).toBe("Amina Uwase");
  });

  it("stores nothing when no name is sent (older app builds)", async () => {
    const res = await request({ payment_method: "bk", recipient_phone: "0788123456" });
    expect(res.status).toBe(200);
    expect(await stored(res.body.transactionId)).toBeNull();
  });

  it("does not keep a name on a MoMo payment or a bank-account payment", async () => {
    const momo = await request({ payment_method: "momo", recipient_phone: "0788123456", recipient_name: "Amina" });
    expect(await stored(momo.body.transactionId)).toBeNull();
    const bank = await request({
      payment_method: "bk",
      recipient_name: "Amina",
      payment_metadata: { bankAccountNumber: "100081234567", bankAccountName: "ACME Ltd", tinNumber: "123456789" },
    });
    expect(await stored(bank.body.transactionId)).toBeNull();
  });

  it("refuses a name longer than 100 characters", async () => {
    const res = await request({ payment_method: "bk", recipient_phone: "0788123456", recipient_name: "x".repeat(101) });
    expect(res.status).toBe(422);
  });

  it("returns the name with the transaction", async () => {
    const res = await request({ payment_method: "bk", recipient_phone: "0788123456", recipient_name: "Amina Uwase" });
    const list = await app.get("/payments/transactions").set(memberH);
    expect(list.body.find((t: any) => t.id === res.body.transactionId)?.recipient_name).toBe("Amina Uwase");
  });
});

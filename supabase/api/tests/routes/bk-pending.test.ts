import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";
import { bk } from "../../src/lib/bk.js";
import { UrubutoUnknownOutcomeError } from "../../src/lib/urubutopay/client.js";

// A real BK transfer is rarely terminal at the first look (UrubutoPay debits
// the wallet first, pays the beneficiary after). These tests pin what the app
// does in that window: hold the money, never refund on "pending" or "unknown".
describe("BK payments — in-flight and unknown outcomes", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let locationId: string;
  const transactionIds: string[] = [];

  const remaining = async () =>
    Number(
      (await maybeOne<{ remaining_amount: string }>(
        "select remaining_amount from monthly_budgets where year = $1 and month = $2",
        [new Date().getFullYear(), new Date().getMonth() + 1],
      ))!.remaining_amount,
    );

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const loc = await app.post("/locations").set(adminH).send({ name: `bk-pending-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    await exec("update profiles set has_payment_permission = true where id = $1", [me.body.user.id]);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    for (const id of transactionIds) await app.delete(`/payments/${id}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  async function newRequest(label: string) {
    const d = new Date();
    await exec(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) on conflict (year, month) do update set remaining_amount = $3",
      [d.getFullYear(), d.getMonth() + 1, 1_000_000],
    );
    const req = await app.post("/payments/request").set(memberH).send({
      amount: 500,
      location_id: locationId,
      products: [{ name: `Pending Test ${label} ${Date.now()}`, quantity: 1, price: 500 }],
      payment_method: "bk",
      recipient_phone: "0788123456",
    });
    transactionIds.push(req.body.transactionId);
    return req.body.transactionId as string;
  }

  const row = (id: string) =>
    maybeOne<{ status: string; momo_ref: string | null; failure_reason: string | null; is_stocked: boolean }>(
      "select status, momo_ref, failure_reason, is_stocked from corporate_transactions where id = $1",
      [id],
    );

  it("PENDING at the first look: stays processing, budget stays reserved, no stock yet", async () => {
    const id = await newRequest("pending");
    vi.spyOn(bk, "transfer").mockResolvedValue("UPG1:" + id);
    vi.spyOn(bk, "getTransferStatus").mockResolvedValue({ status: "PENDING" });

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("processing");
    const r = await row(id);
    expect(r?.status).toBe("processing");
    expect(r?.momo_ref).toBe("UPG1:" + id);
    expect(r?.is_stocked).toBe(false);
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("unknown outcome (timeout) on dispatch: held as processing, budget NOT refunded", async () => {
    const id = await newRequest("unknown");
    vi.spyOn(bk, "transfer").mockRejectedValue(new UrubutoUnknownOutcomeError("no response (TimeoutError)"));

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(202);
    expect(res.body.code).toBe("bk_outcome_unknown");
    const r = await row(id);
    expect(r?.status).toBe("processing");
    expect(r?.failure_reason).toMatch(/^UNCONFIRMED/);
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("status lookup throwing after a successful dispatch does NOT refund", async () => {
    const id = await newRequest("lookup-fails");
    vi.spyOn(bk, "transfer").mockResolvedValue("UPG2:" + id);
    vi.spyOn(bk, "getTransferStatus").mockRejectedValue(new Error("check-transfer HTTP 502"));

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(202);
    expect((await row(id))?.status).toBe("processing");
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("a definite FAILED from the provider refunds the budget exactly once", async () => {
    const id = await newRequest("failed");
    vi.spyOn(bk, "transfer").mockResolvedValue("UPG3:" + id);
    vi.spyOn(bk, "getTransferStatus").mockResolvedValue({ status: "FAILED", reason: "DECLINED" });

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(400);
    expect((await row(id))?.status).toBe("failed");
    expect(await remaining()).toBe(1_000_000);
  });

  it("reconcile settles a stuck processing transaction once the provider reports SUCCESSFUL", async () => {
    const id = await newRequest("reconcile");
    vi.spyOn(bk, "transfer").mockResolvedValue("UPG4:" + id);
    vi.spyOn(bk, "getTransferStatus").mockResolvedValue({ status: "PENDING" });
    await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });
    expect((await row(id))?.status).toBe("processing");

    vi.spyOn(bk, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    const first = await app.post("/payments/reconcile").set(adminH);
    expect(first.status).toBe(200);
    expect(first.body.completed).toBeGreaterThanOrEqual(1);
    const r = await row(id);
    expect(r?.status).toBe("completed");
    expect(r?.is_stocked).toBe(true);

    // Running it again must not re-apply anything.
    await app.post("/payments/reconcile").set(adminH);
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("reconcile requires admin", async () => {
    const res = await app.post("/payments/reconcile").set(memberH);
    expect(res.status).toBe(403);
  });
});

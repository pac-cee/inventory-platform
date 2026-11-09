import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";
import { momo, MoMoRejectedError, MoMoUnknownOutcomeError } from "../../src/lib/momo.js";

// MTN payouts are asynchronous: right after "202 Accepted" the status is usually
// PENDING. These pin what the app does in that window — the same rules as BK:
// hold the money, never refund on "pending" or "unknown", refund only on a
// confirmed FAILED or a definite refusal.
describe("MoMo payments — in-flight and unknown outcomes", () => {
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
    const loc = await app.post("/locations").set(adminH).send({ name: `momo-pending-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    await exec("update profiles set has_payment_permission = true where id = $1", [me.body.user.id]);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    // Leave no budget row behind for tests that expect none for this month.
    await exec("delete from monthly_budgets where year = $1 and month = $2", [new Date().getFullYear(), new Date().getMonth() + 1]).catch(() => {});
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
      products: [{ name: `MoMo Test ${label} ${Date.now()}`, quantity: 1, price: 500 }],
      payment_method: "momo",
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

  it("sends the payment's own id as the MTN reference", async () => {
    const id = await newRequest("ref");
    const spy = vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });
    expect(spy).toHaveBeenCalledWith("0788123456", 500, id);
    expect((await row(id))?.momo_ref).toBe(id);
  });

  it("SUCCESSFUL at the first look: completed, stock seeded, budget spent", async () => {
    const id = await newRequest("ok");
    vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    const r = await row(id);
    expect(r?.status).toBe("completed");
    expect(r?.is_stocked).toBe(true);
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("PENDING at the first look: stays processing, budget stays reserved, no stock yet", async () => {
    const id = await newRequest("pending");
    vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "PENDING" });

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("processing");
    const r = await row(id);
    expect(r?.status).toBe("processing");
    expect(r?.momo_ref).toBe(id);
    expect(r?.is_stocked).toBe(false);
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("unknown outcome (timeout): held as processing, reference kept, budget NOT refunded", async () => {
    const id = await newRequest("unknown");
    vi.spyOn(momo, "transfer").mockRejectedValue(new MoMoUnknownOutcomeError("MTN did not answer (timed out)"));

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(202);
    expect(res.body.code).toBe("momo_outcome_unknown");
    const r = await row(id);
    expect(r?.status).toBe("processing");
    expect(r?.momo_ref).toBe(id); // kept, so the reconciler can look it up
    expect(r?.failure_reason).toMatch(/^UNCONFIRMED/);
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("a definite refusal: failed, budget refunded, no reference kept", async () => {
    const id = await newRequest("refused");
    vi.spyOn(momo, "transfer").mockRejectedValue(new MoMoRejectedError("MoMo transfer rejected (400)", 400));

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("momo_dispatch_error");
    const r = await row(id);
    expect(r?.status).toBe("failed");
    expect(r?.momo_ref).toBeNull();
    expect(await remaining()).toBe(1_000_000);
  });

  it("status lookup throwing after a successful dispatch does NOT refund", async () => {
    const id = await newRequest("lookup-fails");
    vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    vi.spyOn(momo, "getTransferStatus").mockRejectedValue(new Error("Failed to query transfer status: 500"));

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(202);
    expect((await row(id))?.status).toBe("processing");
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("a confirmed FAILED refunds the budget exactly once and keeps MTN's reason", async () => {
    const id = await newRequest("failed");
    vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "FAILED", reason: { code: "NOT_ENOUGH_FUNDS", message: "x" } });

    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("momo_payment_failed");
    expect(res.body.reason).toBe("NOT_ENOUGH_FUNDS");
    expect(res.body.reason_message).toBeNull(); // not a code MTN's page explains: the raw code is shown
    const r = await row(id);
    expect(r?.status).toBe("failed");
    expect(r?.failure_reason).toBe("NOT_ENOUGH_FUNDS");
    expect(await remaining()).toBe(1_000_000);
  });

  it("a FAILED with MTN's INTERNAL_PROCESSING_ERROR explains itself in plain words (mostly insufficient funds)", async () => {
    const id = await newRequest("plain-words");
    vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "FAILED", reason: { code: "INTERNAL_PROCESSING_ERROR", message: "x" } });
    const res = await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("INTERNAL_PROCESSING_ERROR");
    expect(res.body.reason_message).toMatch(/insufficient funds/i);
  });

  it("reconcile settles a stuck MoMo payment once MTN reports SUCCESSFUL, and only once", async () => {
    const id = await newRequest("reconcile");
    vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "PENDING" });
    await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });
    expect((await row(id))?.status).toBe("processing");

    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    const first = await app.post("/payments/reconcile").set(adminH);
    expect(first.status).toBe(200);
    expect(first.body.completed).toBeGreaterThanOrEqual(1);
    const r = await row(id);
    expect(r?.status).toBe("completed");
    expect(r?.is_stocked).toBe(true);

    await app.post("/payments/reconcile").set(adminH); // again: nothing re-applied
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("reconcile refunds a stuck MoMo payment that MTN reports FAILED", async () => {
    const id = await newRequest("reconcile-failed");
    vi.spyOn(momo, "transfer").mockRejectedValue(new MoMoUnknownOutcomeError("timed out"));
    await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });
    expect(await remaining()).toBe(1_000_000 - 500);

    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "FAILED", reason: { code: "PAYEE_NOT_FOUND", message: "x" } });
    await app.post("/payments/reconcile").set(adminH);
    const r = await row(id);
    expect(r?.status).toBe("failed");
    expect(r?.failure_reason).toBe("PAYEE_NOT_FOUND");
    expect(await remaining()).toBe(1_000_000);
  });

  it("reconcile NEVER refunds when MTN has no record: it is left for a person to check", async () => {
    const id = await newRequest("not-found");
    vi.spyOn(momo, "transfer").mockRejectedValue(new MoMoUnknownOutcomeError("timed out"));
    await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });

    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "PENDING", notFound: true, reason: { code: "REFERENCE_NOT_FOUND", message: "x" } });
    const res = await app.post("/payments/reconcile").set(adminH);

    expect(res.body.needsManualReview).toContain(id);
    expect((await row(id))?.status).toBe("processing");
    expect(await remaining()).toBe(1_000_000 - 500);
  });
});

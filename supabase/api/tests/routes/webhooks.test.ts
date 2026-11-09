import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";
import { env } from "../../src/env.js";
import { bk } from "../../src/lib/bk.js";

describe("POST /webhooks/urubutopay", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let memberId: string;
  let locationId: string;
  const transactionIds: string[] = [];

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const loc = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `webhook-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    memberId = me.body.user.id;
    await exec("update profiles set has_payment_permission = true where id = $1", [memberId]);
    const d = new Date();
    await exec(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) on conflict (year, month) do update set remaining_amount = $3",
      [d.getFullYear(), d.getMonth() + 1, 1_000_000],
    );
  });

  afterAll(async () => {
    for (const id of transactionIds) {
      await app.delete(`/payments/${id}`).set(adminH).catch(() => {});
    }
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  // Creates a BK request via the real route (so it has products/budget
  // wired correctly), then bypasses /payments/resolve and manually puts it
  // into 'processing' with a synthetic momo_ref — simulating "the app
  // already dispatched the transfer and is waiting on a result," which mock
  // mode's always-instant SUCCESSFUL status makes otherwise impossible to
  // reach through the real API.
  async function createProcessingTx(momoRef: string) {
    const req = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        amount: 500,
        location_id: locationId,
        products: [{ name: `Webhook Test Item ${momoRef}`, quantity: 1, price: 500 }],
        payment_method: "bk",
        recipient_phone: "0788123456",
      });
    const id = req.body.transactionId as string;
    transactionIds.push(id);

    const budget = await maybeOne<{ id: string }>(
      "select id from monthly_budgets where year = $1 and month = $2",
      [new Date().getFullYear(), new Date().getMonth() + 1],
    );
    await exec(
      "update corporate_transactions set status = 'processing', momo_ref = $2, budget_id = $3 where id = $1",
      [id, momoRef, budget!.id],
    );
    return id;
  }

  it("finalizes a still-processing transaction as completed on SUCCESSFUL", async () => {
    const momoRef = `internal-ref-ok-${Date.now()}:beneficiary-ok`;
    const [internalRef, beneficiaryCode] = momoRef.split(":");
    const id = await createProcessingTx(momoRef);

    const res = await app.post("/webhooks/urubutopay").send({
      callback_type: "BULK_DISBURSEMENT_PAYMENT",
      internal_transaction_ref_number: internalRef,
      beneficiary_code: beneficiaryCode,
      transaction_status: "SUCCESSFUL",
    });

    expect(res.status).toBe(200);

    const row = await maybeOne<{ status: string; is_stocked: boolean }>(
      "select status, is_stocked from corporate_transactions where id = $1",
      [id],
    );
    expect(row?.status).toBe("completed");
    expect(row?.is_stocked).toBe(true);
  });

  it("finalizes a still-processing transaction as failed on FAILED, refunding the budget", async () => {
    const momoRef = `internal-ref-fail-${Date.now()}:beneficiary-fail`;
    const [internalRef, beneficiaryCode] = momoRef.split(":");
    const id = await createProcessingTx(momoRef);

    const before = await maybeOne<{ remaining_amount: string }>(
      "select b.remaining_amount from monthly_budgets b join corporate_transactions t on t.budget_id = b.id where t.id = $1",
      [id],
    );

    const res = await app.post("/webhooks/urubutopay").send({
      callback_type: "BULK_DISBURSEMENT_PAYMENT",
      internal_transaction_ref_number: internalRef,
      beneficiary_code: beneficiaryCode,
      transaction_status: "FAILED",
    });

    expect(res.status).toBe(200);

    const row = await maybeOne<{ status: string; failure_reason: string | null }>(
      "select status, failure_reason from corporate_transactions where id = $1",
      [id],
    );
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBeTruthy();

    const after = await maybeOne<{ remaining_amount: string }>(
      "select remaining_amount from monthly_budgets where id = (select budget_id from corporate_transactions where id = $1)",
      [id],
    );
    expect(Number(after?.remaining_amount)).toBe(Number(before?.remaining_amount) + 500);
  });

  it("does NOT change an already-terminal transaction, and logs a mismatch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const momoRef = `internal-ref-terminal-${Date.now()}:beneficiary-terminal`;
      const [internalRef, beneficiaryCode] = momoRef.split(":");
      const id = await createProcessingTx(momoRef);
      // Simulate the synchronous /payments/resolve path having already
      // marked this failed (and refunded the budget) before the webhook
      // arrives late and disagrees.
      await exec("update corporate_transactions set status = 'failed', failure_reason = 'BK_PAYMENT_FAILED' where id = $1", [id]);

      const res = await app.post("/webhooks/urubutopay").send({
        callback_type: "BULK_DISBURSEMENT_PAYMENT",
        internal_transaction_ref_number: internalRef,
        beneficiary_code: beneficiaryCode,
        transaction_status: "SUCCESSFUL",
      });

      expect(res.status).toBe(200);

      const row = await maybeOne<{ status: string }>("select status from corporate_transactions where id = $1", [id]);
      expect(row?.status).toBe("failed"); // untouched, not silently flipped to completed

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("MISMATCH"));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("ignores unrelated callback types and unknown references without error", async () => {
    const res1 = await app.post("/webhooks/urubutopay").send({ callback_type: "BULK_DISBURSEMENT_DEBIT" });
    expect(res1.status).toBe(200);

    const res2 = await app.post("/webhooks/urubutopay").send({
      callback_type: "BULK_DISBURSEMENT_PAYMENT",
      internal_transaction_ref_number: "no-such-ref",
      beneficiary_code: "no-such-code",
      transaction_status: "SUCCESSFUL",
    });
    expect(res2.status).toBe(200);
  });

  describe("authentication and verify-before-finalize", () => {
    const savedEnv = { ...env };
    const configure = () =>
      Object.assign(env, { urubutopayWebhookUser: "verlet-hook", urubutopayWebhookPassword: "a-long-random-password" });
    afterEach(() => {
      Object.assign(env, savedEnv);
      vi.restoreAllMocks();
    });

    const getToken = async () => {
      const r = await app.post("/webhooks/urubutopay/auth").send({ user_name: "verlet-hook", password: "a-long-random-password" });
      return r.body.data.token as string;
    };
    const payment = (ref: string, status: string) => {
      const [internal_transaction_ref_number, beneficiary_code] = ref.split(":");
      return { callback_type: "BULK_DISBURSEMENT_PAYMENT", internal_transaction_ref_number, beneficiary_code, transaction_status: status };
    };
    const statusOf = async (id: string) =>
      (await maybeOne<{ status: string }>("select status from corporate_transactions where id = $1", [id]))?.status;

    it("auth endpoint issues a token for the right credentials and 401s otherwise", async () => {
      configure();
      const good = await app.post("/webhooks/urubutopay/auth").send({ user_name: "verlet-hook", password: "a-long-random-password" });
      expect(good.status).toBe(200);
      expect(good.body.status).toBe(200);
      expect(good.body.data.token).toMatch(/^Bearer /);

      const bad = await app.post("/webhooks/urubutopay/auth").send({ user_name: "verlet-hook", password: "nope" });
      expect(bad.status).toBe(401);
      expect(bad.body.data).toBeUndefined();
    });

    it("rejects a callback with no/invalid token and leaves the transaction untouched", async () => {
      configure();
      const ref = `auth-ref-${Date.now()}:auth-ben`;
      const id = await createProcessingTx(ref);

      const none = await app.post("/webhooks/urubutopay").send(payment(ref, "SUCCESSFUL"));
      expect(none.status).toBe(401);
      const bad = await app.post("/webhooks/urubutopay").set("Authorization", "Bearer forged.token.here").send(payment(ref, "SUCCESSFUL"));
      expect(bad.status).toBe(401);
      expect(await statusOf(id)).toBe("processing");
    });

    it("accepts a callback carrying a token from the auth endpoint", async () => {
      configure();
      vi.spyOn(bk, "isMock", "get").mockReturnValue(false);
      vi.spyOn(bk, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
      const ref = `auth-ok-${Date.now()}:auth-ok-ben`;
      const id = await createProcessingTx(ref);

      const res = await app.post("/webhooks/urubutopay").set("Authorization", await getToken()).send(payment(ref, "SUCCESSFUL"));
      expect(res.status).toBe(200);
      expect(await statusOf(id)).toBe("completed");
    });

    it("trusts check-transfer over the callback: a forged SUCCESSFUL while the provider says PENDING does nothing", async () => {
      configure();
      vi.spyOn(bk, "isMock", "get").mockReturnValue(false);
      vi.spyOn(bk, "getTransferStatus").mockResolvedValue({ status: "PENDING" });
      const ref = `verify-pending-${Date.now()}:verify-ben`;
      const id = await createProcessingTx(ref);

      const res = await app.post("/webhooks/urubutopay").set("Authorization", await getToken()).send(payment(ref, "SUCCESSFUL"));
      expect(res.status).toBe(200);
      expect(await statusOf(id)).toBe("processing");
    });

    it("answers 500 (so UrubutoPay retries) and changes nothing when check-transfer is unreachable", async () => {
      configure();
      vi.spyOn(bk, "isMock", "get").mockReturnValue(false);
      vi.spyOn(bk, "getTransferStatus").mockRejectedValue(new Error("HTTP 502"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const ref = `verify-down-${Date.now()}:verify-down-ben`;
      const id = await createProcessingTx(ref);

      const res = await app.post("/webhooks/urubutopay").set("Authorization", await getToken()).send(payment(ref, "FAILED"));
      expect(res.status).toBe(500);
      expect(await statusOf(id)).toBe("processing");
    });
  });
});

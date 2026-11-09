import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";
import { momo } from "../../src/lib/momo.js";

// MTN calls /webhooks/mtn/<payment id> once when a transfer settles (PUT or POST, no
// signature, no retry). The body is never trusted: the handler only uses the id in
// the path to ask MTN for the real status.
describe("MTN callback", () => {
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
  const row = (id: string) =>
    maybeOne<{ status: string; is_stocked: boolean; failure_reason: string | null }>(
      "select status, is_stocked, failure_reason from corporate_transactions where id = $1",
      [id],
    );

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const loc = await app.post("/locations").set(adminH).send({ name: `mtn-cb-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    await exec("update profiles set has_payment_permission = true where id = $1", [me.body.user.id]);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await exec("delete from monthly_budgets where year = $1 and month = $2", [new Date().getFullYear(), new Date().getMonth() + 1]).catch(() => {});
    for (const id of transactionIds) await app.delete(`/payments/${id}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  /** A MoMo payment approved and left 'processing' (MTN said PENDING), as in real life. */
  async function inFlight(label: string) {
    const d = new Date();
    await exec(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) on conflict (year, month) do update set remaining_amount = $3",
      [d.getFullYear(), d.getMonth() + 1, 1_000_000],
    );
    const req = await app.post("/payments/request").set(memberH).send({
      amount: 500,
      location_id: locationId,
      products: [{ name: `MTN Callback ${label} ${Date.now()}`, quantity: 1, price: 500 }],
      payment_method: "momo",
      recipient_phone: "0788123456",
    });
    const id = req.body.transactionId as string;
    transactionIds.push(id);
    vi.spyOn(momo, "transfer").mockImplementation(async (_p, _a, ref) => ref);
    const status = vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "PENDING" });
    await app.post("/payments/resolve").set(adminH).send({ id, status: "approved" });
    expect((await row(id))?.status).toBe("processing");
    status.mockReset();
    return id;
  }

  it("a PUT callback settles a payment once MTN confirms SUCCESSFUL: stock in, budget spent", async () => {
    const id = await inFlight("put");
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    const res = await app.put(`/webhooks/mtn/${id}`).send({ status: "SUCCESSFUL", financialTransactionId: "730399" });
    expect(res.status).toBe(200);
    const r = await row(id);
    expect(r?.status).toBe("completed");
    expect(r?.is_stocked).toBe(true);
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("a POST callback works the same way (MTN's page shows both)", async () => {
    const id = await inFlight("post");
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    expect((await app.post(`/webhooks/mtn/${id}`).send({})).status).toBe(200);
    expect((await row(id))?.status).toBe("completed");
  });

  it("never trusts the body: it says FAILED but MTN says SUCCESSFUL, so the payment completes", async () => {
    const id = await inFlight("liar-fail");
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    await app.put(`/webhooks/mtn/${id}`).send({ status: "FAILED", reason: { code: "NOT_ENOUGH_FUNDS" } });
    expect((await row(id))?.status).toBe("completed");
  });

  it("…and the other way round: the body says SUCCESSFUL but MTN says FAILED, so it fails and the budget returns", async () => {
    const id = await inFlight("liar-ok");
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "FAILED", reason: { code: "PAYEE_NOT_FOUND", message: "x" } });
    await app.put(`/webhooks/mtn/${id}`).send({ status: "SUCCESSFUL" });
    const r = await row(id);
    expect(r?.status).toBe("failed");
    expect(r?.failure_reason).toBe("PAYEE_NOT_FOUND");
    expect(await remaining()).toBe(1_000_000);
  });

  it("MTN still saying PENDING changes nothing", async () => {
    const id = await inFlight("pending");
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "PENDING" });
    expect((await app.put(`/webhooks/mtn/${id}`).send({ status: "SUCCESSFUL" })).status).toBe(200);
    expect((await row(id))?.status).toBe("processing");
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("'no record at MTN' and a failed lookup change nothing (the reconciler handles them)", async () => {
    const id = await inFlight("lookup");
    vi.spyOn(momo, "getTransferStatus").mockResolvedValueOnce({ status: "PENDING", notFound: true });
    expect((await app.put(`/webhooks/mtn/${id}`).send({})).status).toBe(200);
    vi.spyOn(momo, "getTransferStatus").mockRejectedValueOnce(new Error("MTN 500"));
    expect((await app.put(`/webhooks/mtn/${id}`).send({})).status).toBe(200);
    expect((await row(id))?.status).toBe("processing");
    expect(await remaining()).toBe(1_000_000 - 500);
  });

  it("a second callback for a settled payment applies nothing twice", async () => {
    const id = await inFlight("twice");
    vi.spyOn(momo, "getTransferStatus").mockResolvedValue({ status: "SUCCESSFUL" });
    await app.put(`/webhooks/mtn/${id}`).send({});
    const spent = await remaining();
    const lookups = vi.mocked(momo.getTransferStatus).mock.calls.length;
    await app.put(`/webhooks/mtn/${id}`).send({});
    expect(await remaining()).toBe(spent);
    expect(vi.mocked(momo.getTransferStatus).mock.calls.length).toBe(lookups); // not even asked again
  });

  it("an unknown or malformed reference gets a plain 200 and touches nothing", async () => {
    const lookup = vi.spyOn(momo, "getTransferStatus");
    expect((await app.put("/webhooks/mtn/00000000-0000-4000-8000-000000000000").send({})).status).toBe(200);
    expect((await app.put("/webhooks/mtn/not-a-uuid").send({})).status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("only PUT and POST are accepted", async () => {
    const id = await inFlight("method");
    expect((await app.get(`/webhooks/mtn/${id}`)).status).toBe(404);
    expect((await row(id))?.status).toBe("processing");
  });
});

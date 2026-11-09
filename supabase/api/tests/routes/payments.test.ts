import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";
import { momo } from "../../src/lib/momo.js";
import { bk } from "../../src/lib/bk.js";

describe("payments route", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let memberId: string;
  let locationId: string;
  let transactionId: string;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");

    const loc = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `pay-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;

    const me = await app.get("/auth/me").set(memberH);
    memberId = me.body.user.id;
    // Grant payment permission up front (deterministic).
    await exec("update profiles set has_payment_permission = true where id = $1", [memberId]);
  });

  afterAll(async () => {
    if (transactionId)
      await app.delete(`/payments/${transactionId}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.post("/payments/request").send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 (forbidden) for a user without payment permission", async () => {
    await exec("update profiles set has_payment_permission = false where id = $1", [memberId]);
    const res = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        recipient_phone: "+250788000000",
        amount: 1000,
        location_id: locationId,
        products: [{ name: "Widget", quantity: 2, price: 500 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("forbidden");
    // restore for the rest of the suite
    await exec("update profiles set has_payment_permission = true where id = $1", [memberId]);
  });

  it("creates a pending payment request (mock MoMo mode)", async () => {
    const res = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        recipient_phone: "+250788000000",
        amount: 1000,
        location_id: locationId,
        products: [{ name: "Widget", quantity: 2, price: 500 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.transactionId).toBeTruthy();
    expect(res.body.status).toBe("pending");
    transactionId = res.body.transactionId;
  });

  it("returns a specific, actionable error when the request's location was deleted out from under it", async () => {
    // A location with zero stock/movement/transaction history can be hard-
    // deleted (locations.ts DELETE /locations/:id) — simulating a client
    // that had it cached in an open form when that happened.
    const loc = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `pay-stale-loc-${Date.now()}`, description: "test" });
    const staleLocationId = loc.body.id;
    const del = await app.delete(`/locations/${staleLocationId}`).set(adminH);
    // 204, not 200: a location with no history is HARD-deleted, as the comment
    // above says. 200-with-a-body is the ARCHIVE path, taken only when past
    // movements or transactions reference it. Pre-existing wrong assertion.
    expect(del.status).toBe(204);

    const res = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        recipient_phone: "+250788000000",
        amount: 500,
        location_id: staleLocationId,
        products: [{ name: "Stale Location Widget", quantity: 1, price: 500 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("location_not_found");
    expect(res.body.error?.message).toMatch(/no longer exists/i);
  });

  it("resolve saga: rejects with 400 when no monthly budget allocated", async () => {
    // Other test files (BK / MoMo pending) leave a budget row for the current
    // month behind, and files share one database — so this test creates its own
    // "no budget" situation instead of assuming it.
    const created = await maybeOne<{ created_at: string }>(
      "select created_at from corporate_transactions where id = $1",
      [transactionId],
    );
    const when = new Date(created!.created_at);
    await exec("delete from monthly_budgets where year = $1 and month = $2", [when.getFullYear(), when.getMonth() + 1]);

    const res = await app
      .post("/payments/resolve")
      .set(adminH)
      .send({ id: transactionId, status: "approved" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("insufficient_budget");
  });

  it("resolve saga: approves once a sufficient monthly budget exists", async () => {
    // The previous test left the tx 'failed'; reset to pending for this branch.
    await exec(
      "update corporate_transactions set status = 'pending', failure_reason = null where id = $1",
      [transactionId],
    );
    const tx = await maybeOne<{ created_at: string }>(
      "select created_at from corporate_transactions where id = $1",
      [transactionId],
    );
    const d = new Date(tx!.created_at);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    await exec(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) on conflict (year, month) do update set remaining_amount = $3",
      [year, month, 1_000_000],
    );

    const res = await app
      .post("/payments/resolve")
      .set(adminH)
      .send({ id: transactionId, status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });
});

describe("payments route — MoMo dispatch failure (E6 resilience)", () => {
  // Spy on the singleton's transfer so the failure branch is exercised WITHOUT
  // mocking the module file-wide (which would break the success-path tests).
  let transferSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(() => {
    transferSpy = vi
      .spyOn(momo, "transfer")
      .mockRejectedValue(new Error("MoMo transfer request rejected: status 500"));
  });
  afterAll(() => transferSpy?.mockRestore());

  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let memberId: string;
  let locationId: string;
  let transactionId: string;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const loc = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `pay-fail-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    memberId = me.body.user.id;
    await exec("update profiles set has_payment_permission = true where id = $1", [memberId]);
  });

  afterAll(async () => {
    if (transactionId) await app.delete(`/payments/${transactionId}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  it("marks the transaction FAILED (not a crash) when MoMo dispatch throws", async () => {
    const req = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        recipient_phone: "+250****0000",
        amount: 500,
        location_id: locationId,
        products: [{ name: "Gadget", quantity: 1, price: 500 }],
      });
    transactionId = req.body.transactionId;

    const d = new Date();
    await exec(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) on conflict (year, month) do update set remaining_amount = $3",
      [d.getFullYear(), d.getMonth() + 1, 1_000_000],
    );

    const res = await app
      .post("/payments/resolve")
      .set(adminH)
      .send({ id: transactionId, status: "approved" });

    // The fix: returns 502 (handled) instead of an unhandled rejection.
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("momo_dispatch_error");

    const row = await maybeOne<{ status: string; failure_reason: string | null }>(
      "select status, failure_reason from corporate_transactions where id = $1",
      [transactionId],
    );
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBeTruthy();
  });
});

describe("payments route — BK dispatch failure", () => {
  // Same style as the MoMo dispatch-failure block above: spy on the
  // singleton's transfer() rather than mocking the module file-wide.
  let transferSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(() => {
    transferSpy = vi
      .spyOn(bk, "transfer")
      .mockRejectedValue(new Error("BK transfer initiate rejected: status 500"));
  });
  afterAll(() => transferSpy?.mockRestore());

  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let memberId: string;
  let locationId: string;
  let transactionId: string;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const loc = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `pay-bk-fail-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    memberId = me.body.user.id;
    await exec("update profiles set has_payment_permission = true where id = $1", [memberId]);
  });

  afterAll(async () => {
    if (transactionId) await app.delete(`/payments/${transactionId}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  it("marks the transaction FAILED (not a crash) when BK dispatch throws", async () => {
    const req = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        amount: 500,
        location_id: locationId,
        products: [{ name: "Gadget", quantity: 1, price: 500 }],
        payment_method: "bk",
        payment_metadata: {
          bankAccountNumber: "100081234567",
          bankAccountName: "Test Recipient",
          tinNumber: "123456789",
        },
      });
    transactionId = req.body.transactionId;

    const d = new Date();
    await exec(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) on conflict (year, month) do update set remaining_amount = $3",
      [d.getFullYear(), d.getMonth() + 1, 1_000_000],
    );

    const res = await app
      .post("/payments/resolve")
      .set(adminH)
      .send({ id: transactionId, status: "approved" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("bk_dispatch_error");

    const row = await maybeOne<{ status: string; failure_reason: string | null }>(
      "select status, failure_reason from corporate_transactions where id = $1",
      [transactionId],
    );
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBeTruthy();
  });
});

describe("payments route — BK happy path, both patterns (mock mode)", () => {
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
      .send({ name: `pay-bk-ok-loc-${Date.now()}`, description: "test" });
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

  it("Pattern 2 (phone — employee reimbursement) completes end to end", async () => {
    const req = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        amount: 500,
        location_id: locationId,
        products: [{ name: "Gadget", quantity: 1, price: 500 }],
        payment_method: "bk",
        recipient_phone: "0788123456",
      });
    expect(req.status).toBe(200);
    transactionIds.push(req.body.transactionId);

    const res = await app
      .post("/payments/resolve")
      .set(adminH)
      .send({ id: req.body.transactionId, status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });

  it("Pattern 1 (bank account — vendor payment) completes end to end", async () => {
    const req = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        amount: 500,
        location_id: locationId,
        products: [{ name: "Gadget", quantity: 1, price: 500 }],
        payment_method: "bk",
        payment_metadata: {
          bankAccountNumber: "100081234567",
          bankAccountName: "Test Vendor Ltd",
          tinNumber: "123456789",
        },
      });
    expect(req.status).toBe(200);
    transactionIds.push(req.body.transactionId);

    const res = await app
      .post("/payments/resolve")
      .set(adminH)
      .send({ id: req.body.transactionId, status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
  });
});

describe("GET /payments/reports/detailed", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  let memberId: string;
  let locationId: string;
  let transactionId: string;
  const productName = `Detailed Report Widget ${Date.now()}`;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const loc = await app
      .post("/locations")
      .set(adminH)
      .send({ name: `pay-report-loc-${Date.now()}`, description: "test" });
    locationId = loc.body.id;
    const me = await app.get("/auth/me").set(memberH);
    memberId = me.body.user.id;
    await exec("update profiles set has_payment_permission = true where id = $1", [memberId]);
    const d = new Date();
    await exec(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) on conflict (year, month) do update set remaining_amount = $3",
      [d.getFullYear(), d.getMonth() + 1, 1_000_000],
    );

    const req = await app
      .post("/payments/request")
      .set(memberH)
      .send({
        recipient_phone: "+250788000000",
        amount: 500,
        location_id: locationId,
        products: [{ name: productName, quantity: 1, price: 500 }],
      });
    transactionId = req.body.transactionId;
    await app.post("/payments/resolve").set(adminH).send({ id: transactionId, status: "approved" });
  });

  afterAll(async () => {
    if (transactionId) await app.delete(`/payments/${transactionId}`).set(adminH).catch(() => {});
    if (locationId) await app.delete(`/locations/${locationId}`).set(adminH).catch(() => {});
  });

  it("requires admin", async () => {
    const res = await app.get("/payments/reports/detailed").set(memberH);
    expect(res.status).toBe(403);
  });

  it("filters by user_id, item text, and date range together", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await app
      .get("/payments/reports/detailed")
      .query({ user_id: memberId, item: productName, from: yesterday, to: tomorrow })
      .set(adminH);

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    const found = res.body.rows.find((r: any) => r.id === transactionId);
    expect(found).toBeTruthy();
    expect(found.transaction_products.some((p: any) => p.name === productName)).toBe(true);
    expect(res.body.summary.byStatus.completed).toBeGreaterThanOrEqual(1);
  });

  it("excludes transactions when the item filter doesn't match", async () => {
    const res = await app
      .get("/payments/reports/detailed")
      .query({ user_id: memberId, item: `no-such-product-${Date.now()}` })
      .set(adminH);

    expect(res.status).toBe(200);
    expect(res.body.rows.find((r: any) => r.id === transactionId)).toBeUndefined();
  });

  it("excludes transactions outside the date range", async () => {
    const farPast = new Date("2000-01-01").toISOString();
    const alsoFarPast = new Date("2000-06-01").toISOString();

    const res = await app
      .get("/payments/reports/detailed")
      .query({ user_id: memberId, from: farPast, to: alsoFarPast })
      .set(adminH);

    expect(res.status).toBe(200);
    expect(res.body.rows.find((r: any) => r.id === transactionId)).toBeUndefined();
  });
});

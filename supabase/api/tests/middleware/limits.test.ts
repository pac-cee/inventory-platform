import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { verifyLimits } from "../../src/middleware/limits.js";
import * as db from "../../src/db.js";

// verifyLimits reads the profile from req.profile (attached by requireAuth)
// and only hits the DB (db.maybeOne) to sum completed spend for daily/monthly
// limits. We mock db.maybeOne to return the right "spent" amount per call.
const maybeOne = vi.spyOn(db, "maybeOne");

interface ProfileOpts {
  role?: string;
  fallback_role?: string;
  has_payment_permission?: boolean;
  per_transaction_limit?: number;
  daily_limit?: number;
  monthly_limit?: number;
}

function makeReq(
  amount: unknown,
  profile: ProfileOpts | null = {
    role: "admin",
    fallback_role: "none",
    has_payment_permission: false,
    per_transaction_limit: 0,
    daily_limit: 0,
    monthly_limit: 0,
  },
  dailySpent = 0,
  monthlySpent = 0,
): Partial<Request> {
  // spentSince calls maybeOne in order: daily first (if daily_limit>0),
  // then monthly (if monthly_limit>0).
  maybeOne.mockReset();
  if ((profile?.daily_limit ?? 0) > 0) {
    maybeOne.mockResolvedValueOnce({ spent: dailySpent });
  }
  if ((profile?.monthly_limit ?? 0) > 0) {
    maybeOne.mockResolvedValueOnce({ spent: monthlySpent });
  }
  return {
    body: { amount },
    user: { id: "uid", email: "u@test.com" },
    profile: profile as never,
  } as Partial<Request>;
}

function next() {
  return vi.fn() as unknown as NextFunction;
}

describe("verifyLimits", () => {
  it("rejects missing amount with 400 invalid_amount", async () => {
    const n = next();
    await verifyLimits(makeReq(undefined) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_amount");
  });

  it("rejects negative amount with 400 invalid_amount", async () => {
    const n = next();
    await verifyLimits(makeReq(-50) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_amount");
  });

  it("rejects when profile cannot be loaded", async () => {
    const n = next();
    await verifyLimits(makeReq(100, null) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.code).toBe("profile_load_failed");
  });

  it("rejects member without payment permission with 403 no_payment_permission", async () => {
    const n = next();
    await verifyLimits(
      makeReq(100, {
        role: "member",
        fallback_role: "none",
        has_payment_permission: false,
        per_transaction_limit: 0,
        daily_limit: 0,
        monthly_limit: 0,
      }) as Request,
      {} as Response,
      n,
    );
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.code).toBe("no_payment_permission");
  });

  it("allows member WITH payment permission", async () => {
    const n = next();
    await verifyLimits(
      makeReq(100, {
        role: "member",
        fallback_role: "none",
        has_payment_permission: true,
        per_transaction_limit: 0,
        daily_limit: 0,
        monthly_limit: 0,
      }) as Request,
      {} as Response,
      n,
    );
    expect(n).toHaveBeenCalledWith();
  });

  it("allows cashier fallback_role without payment permission", async () => {
    const n = next();
    await verifyLimits(
      makeReq(100, {
        role: "member",
        fallback_role: "cashier",
        has_payment_permission: false,
        per_transaction_limit: 0,
        daily_limit: 0,
        monthly_limit: 0,
      }) as Request,
      {} as Response,
      n,
    );
    expect(n).toHaveBeenCalledWith();
  });

  it("rejects amount exceeding per_transaction_limit with 422", async () => {
    const n = next();
    await verifyLimits(
      makeReq(600, {
        role: "admin",
        fallback_role: "none",
        has_payment_permission: false,
        per_transaction_limit: 500,
        daily_limit: 0,
        monthly_limit: 0,
      }) as Request,
      {} as Response,
      n,
    );
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(422);
    expect(err.code).toBe("limit_per_transaction_exceeded");
  });

  it("rejects when daily spend + amount exceeds daily_limit with 422", async () => {
    const n = next();
    await verifyLimits(
      makeReq(200, {
        role: "admin",
        fallback_role: "none",
        has_payment_permission: false,
        per_transaction_limit: 0,
        daily_limit: 1000,
        monthly_limit: 0,
      }, 900) as Request,
      {} as Response,
      n,
    );
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(422);
    expect(err.code).toBe("limit_daily_exceeded");
  });

  it("rejects when monthly spend + amount exceeds monthly_limit with 422", async () => {
    const n = next();
    await verifyLimits(
      makeReq(200, {
        role: "admin",
        fallback_role: "none",
        has_payment_permission: false,
        per_transaction_limit: 0,
        daily_limit: 0,
        monthly_limit: 5000,
      }, 0, 4900) as Request,
      {} as Response,
      n,
    );
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(422);
    expect(err.code).toBe("limit_monthly_exceeded");
  });

  it("rejects monthly limit when daily passes but monthly fails (both limits set)", async () => {
    const n = next();
    await verifyLimits(
      makeReq(200, {
        role: "admin",
        fallback_role: "none",
        has_payment_permission: false,
        per_transaction_limit: 0,
        daily_limit: 1000, // daily_spent=100 + 200 = 300 → passes
        monthly_limit: 500, // monthly_spent=400 + 200 = 600 → fails
      }, 100, 400) as Request,
      {} as Response,
      n,
    );
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(422);
    expect(err.code).toBe("limit_monthly_exceeded");
  });

  it("calls next() when all limits are within bounds", async () => {
    const n = next();
    await verifyLimits(
      makeReq(100, {
        role: "admin",
        fallback_role: "none",
        has_payment_permission: false,
        per_transaction_limit: 500,
        daily_limit: 1000,
        monthly_limit: 5000,
      }, 200, 1000) as Request,
      {} as Response,
      n,
    );
    expect(n).toHaveBeenCalledWith();
  });

  it("calls next() when all limits are zero (no limits configured)", async () => {
    const n = next();
    await verifyLimits(
      makeReq(999999, {
        role: "admin",
        fallback_role: "none",
        has_payment_permission: false,
        per_transaction_limit: 0,
        daily_limit: 0,
        monthly_limit: 0,
      }) as Request,
      {} as Response,
      n,
    );
    expect(n).toHaveBeenCalledWith();
  });
});

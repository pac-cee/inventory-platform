import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import * as db from "../../src/db.js";

// Mock jose so jwtVerify is a controllable vi.fn (no real crypto).
vi.mock("jose");
import * as jose from "jose";

const maybeOne = vi.spyOn(db, "maybeOne");

const { requireAuth, requireAdmin } = await import("../../src/middleware/auth.js");

const FAKE_TOKEN = "fake.jwt.token";
const FAKE_USER = { id: "user-id", email: "user@test.com" };
const FAKE_SID = "11111111-1111-1111-1111-111111111111";
// Every token this API issues names the session it belongs to; the session is
// what logout, blocking and password changes revoke.
const FAKE_PAYLOAD = { sub: FAKE_USER.id, email: FAKE_USER.email, sid: FAKE_SID };

function makeReq(authHeader?: string): Partial<Request> {
  return {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? authHeader : undefined,
  } as Partial<Request>;
}

function makeNext() {
  return vi.fn() as unknown as NextFunction;
}

function fakeProfile(over: Partial<db.Profile> = {}) {
  return {
    id: FAKE_USER.id,
    full_name: null,
    role: "admin",
    blocked: false,
    fallback_role: null,
    has_payment_permission: false,
    daily_limit: 0,
    monthly_limit: 0,
    per_transaction_limit: 0,
    // The lookup returns the account and whether its session is still live.
    session_alive: true,
    ...over,
  } as unknown as db.Profile;
}

beforeEach(() => {
  vi.clearAllMocks();
  (jose.jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    payload: FAKE_PAYLOAD,
  });
  maybeOne.mockResolvedValue(fakeProfile());
});

describe("requireAuth", () => {
  it("calls next(HttpError 401 no_token) when no Authorization header", async () => {
    const n = makeNext();
    await requireAuth(makeReq() as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe("no_token");
  });

  it("calls next(HttpError 401 no_token) for malformed Bearer header", async () => {
    const n = makeNext();
    await requireAuth(makeReq("Token abc123") as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe("no_token");
  });

  it("calls next(HttpError 401 invalid_token) when jwtVerify throws", async () => {
    (jose.jwtVerify as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("bad token"),
    );
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_token");
  });

  it("calls next(HttpError 401 invalid_token) when JWT payload has no sub claim", async () => {
    (jose.jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      payload: { email: "x@test.com" },
    });
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_token");
  });

  it("calls next(HttpError 403 account_blocked) when profile is blocked", async () => {
    maybeOne.mockResolvedValue(fakeProfile({ blocked: true }));
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.code).toBe("account_blocked");
  });

  it("attaches req.user, req.accessToken and calls next() for valid token", async () => {
    const n = makeNext();
    const req = makeReq(`Bearer ${FAKE_TOKEN}`) as Request;
    await requireAuth(req, {} as Response, n);
    expect(n).toHaveBeenCalledWith();
    expect((req as { user: { id: string; email: string } }).user).toEqual(FAKE_USER);
    expect((req as { accessToken: string }).accessToken).toBe(FAKE_TOKEN);
    expect((req as { profile: db.Profile }).profile).toBeDefined();
  });

  it("calls next(HttpError 401 invalid_token) when the token names no session", async () => {
    // Nothing to revoke against, so it cannot be honoured.
    (jose.jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      payload: { sub: FAKE_USER.id, email: FAKE_USER.email },
    });
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_token");
  });

  it("calls next(HttpError 401 account_not_found) when the profile is gone", async () => {
    // Deleting a user cascades to profiles. This used to call next() — undefined
    // is falsy, so a deleted account passed the blocked check by having no row,
    // and kept full access until its token expired.
    maybeOne.mockResolvedValue(null);
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe("account_not_found");
  });

  it("calls next(HttpError 401 session_revoked) when the session has been ended", async () => {
    // Signed out, or signed out by a password change elsewhere. The token stays
    // cryptographically valid, so this is the only thing standing in its way.
    maybeOne.mockResolvedValue(fakeProfile({ session_alive: false } as never));
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.code).toBe("session_revoked");
  });

  it("blocks before it checks the session, so the reason given is the useful one", async () => {
    maybeOne.mockResolvedValue(fakeProfile({ blocked: true, session_alive: false } as never));
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.code).toBe("account_blocked");
  });

  it("calls next(err) when the profile query fails", async () => {
    maybeOne.mockRejectedValue(new Error("db error"));
    const n = makeNext();
    await requireAuth(makeReq(`Bearer ${FAKE_TOKEN}`) as Request, {} as Response, n);
    expect((n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(
      Error,
    );
  });
});

describe("requireAdmin", () => {
  function makeAuthedReq(role: string) {
    return {
      user: FAKE_USER,
      profile: fakeProfile({ role }),
    } as unknown as Request;
  }

  it("calls next(HttpError 403 not_admin) for member role", async () => {
    const n = makeNext();
    await requireAdmin(makeAuthedReq("member"), {} as Response, n);
    const err = (n as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.code).toBe("not_admin");
  });

  it("calls next() for admin role", async () => {
    const n = makeNext();
    await requireAdmin(makeAuthedReq("admin"), {} as Response, n);
    expect(n).toHaveBeenCalledWith();
  });
});

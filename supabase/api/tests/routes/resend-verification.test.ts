import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock the mailer so the verification token is captured instead of emailed.
vi.mock("../../src/lib/mailer.js", () => ({
  sendVerificationEmail: vi.fn(async (_: { to: string; verifyUrl: string }) => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}));
import { sendVerificationEmail } from "../../src/lib/mailer.js";

import { app } from "../helpers/app.js";
import { approveSignup } from "../helpers/auth.js";
import { maybeOne } from "../../src/db.js";

const sendMock = sendVerificationEmail as unknown as ReturnType<typeof vi.fn>;

/**
 * POST /auth/resend-verification — the recovery path for an account whose
 * verification email never arrived. Signup deliberately does not fail when the
 * send throws (a Resend blip must not block registration), which leaves the row
 * committed as unverified; login rejects it, so without a resend the account is
 * permanently locked out.
 */
describe("resend verification (E3 recovery)", () => {
  const email = `resend-${Date.now()}@inventory.test`;
  const password = "ResendPass123!";

  beforeAll(async () => {
    const res = await app.post("/auth/signup").send({ email, password });
    expect(res.status).toBe(201);
    sendMock.mockClear();
  });

  afterAll(async () => {
    const u = await maybeOne<{ id: string }>("select id from users where email = $1", [email]);
    if (u) {
      const admin = await import("../helpers/auth.js").then((m) => m.authHeaders("admin"));
      await app.delete(`/users/${u.id}`).set(admin).catch(() => {});
    }
  });

  it("sends a fresh link for an unverified account", async () => {
    const res = await app.post("/auth/resend-verification").send({ email });
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe(email);
    expect(new URL(call.verifyUrl).pathname).toBe("/verify");
  });

  it("issues a token that actually verifies the account", async () => {
    sendMock.mockClear();
    await app.post("/auth/resend-verification").send({ email });
    const token = new URL(sendMock.mock.calls[0][0].verifyUrl).searchParams.get("token");
    const verified = await app.post("/auth/verify-email").send({ token });
    expect(verified.status).toBe(200);
    // Verifying proves the address; an admin still has to let the account in.
    await approveSignup(email);
    const login = await app.post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.session?.access_token).toBeTruthy();
  });

  it("is a silent no-op once the account is already verified", async () => {
    // Previous test confirmed this account — resending must not mail again.
    sendMock.mockClear();
    const res = await app.post("/auth/resend-verification").send({ email });
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("responds 200 without sending for an unknown email (no enumeration)", async () => {
    sendMock.mockClear();
    const res = await app
      .post("/auth/resend-verification")
      .send({ email: "nobody-here@inventory.test" });
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed email with 422", async () => {
    // 422 is what a schema failure returns everywhere in this API — the route
    // does `resendVerificationBody.parse(req.body)` exactly like signup and
    // login, and errorHandler maps ZodError to 422 (auth.test.ts asserts the
    // same for a missing email, missing password and a short password). The
    // 400s in password-reset.test.ts are a different thing: business rules
    // raised as explicit HttpError(400) — reset_token_used, invalid_reset_token,
    // reset_token_expired. This expected 400 for a schema failure, so it had
    // never passed.
    const res = await app.post("/auth/resend-verification").send({ email: "not-an-email" });
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("validation_error");
  });
});

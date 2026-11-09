import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock the mailer so the reset token is captured instead of emailed (fast +
// deterministic; proves the email WOULD be sent with the right link).
vi.mock("../../src/lib/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async (_: { to: string; resetUrl: string }) => {}),
  sendVerificationEmail: vi.fn(async (_: { to: string; verifyUrl: string }) => {}),
}));
import { sendPasswordResetEmail } from "../../src/lib/mailer.js";

import { app } from "../helpers/app.js";
import { approveSignup } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";

describe("password reset (E2)", () => {
  const email = `reset-${Date.now()}@inventory.test`;
  const password = "OldPass123!";
  const newPassword = "NewPass456!";
  let token = "";

  beforeAll(async () => {
    await app.post("/auth/signup").send({ email, password });
    // Forgot-password issues a token; the mocked mailer captures the link.
    const res = await app.post("/auth/forgot-password").send({ email });
    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const call = (sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.to).toBe(email);
    // Extract the raw token from the emailed reset URL.
    const url = new URL(call.resetUrl);
    token = url.searchParams.get("token") as string;
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    const u = await maybeOne<{ id: string }>("select id from users where email = $1", [email]);
    if (u) await app.delete(`/users/${u.id}`).set(await import("../helpers/auth.js").then((m) => m.authHeaders("admin"))).catch(() => {});
  });

  it("emails a link to the web reset route, not a 404", async () => {
    // Regression guard: the link pointed at /reset while the page lives at
    // /reset-password, so every emailed link 404'd — and /reset isn't in the
    // public-route whitelist either, so it redirected to /login. Extracting the
    // token alone (as the tests above do) can't catch a wrong path.
    const call = (sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(new URL(call.resetUrl).pathname).toBe("/reset-password");
  });

  it("forgot-password is silent for unknown emails (no enumeration)", async () => {
    const res = await app.post("/auth/forgot-password").send({ email: "does-not-exist@inventory.test" });
    expect(res.status).toBe(200);
  });

  it("reset-password sets a new password and lets the user log in", async () => {
    const res = await app.post("/auth/reset-password").send({ token, new_password: newPassword });
    expect(res.status).toBe(200);
    // Old password no longer works.
    const oldLogin = await app.post("/auth/login").send({ email, password });
    expect(oldLogin.status).toBe(401);
    // New password works — once the account has been let in. Reset sets a
    // password; it does not decide whether the person may sign in.
    await approveSignup(email);
    const newLogin = await app.post("/auth/login").send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.session?.access_token).toBeTruthy();
  });

  it("reset-password rejects reuse of the same token (single-use)", async () => {
    const res = await app.post("/auth/reset-password").send({ token, new_password: "Another789!" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("reset_token_used");
  });

  it("reset-password rejects an invalid token", async () => {
    const res = await app.post("/auth/reset-password").send({ token: "not-a-real-token", new_password: newPassword });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_reset_token");
  });

  it("requesting a second reset invalidates the first token (Phase B #6)", async () => {
    // Fresh user so we control token state.
    const email2 = `reset2-${Date.now()}@inventory.test`;
    await app.post("/auth/signup").send({ email: email2, password: "SeedPass123!" });
    const first = await app.post("/auth/forgot-password").send({ email: email2 });
    expect(first.status).toBe(200);
    const firstToken = new URL((sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].resetUrl).searchParams.get("token") as string;
    // Second request — should invalidate the first.
    const second = await app.post("/auth/forgot-password").send({ email: email2 });
    expect(second.status).toBe(200);
    const secondToken = new URL((sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].resetUrl).searchParams.get("token") as string;
    expect(secondToken).not.toBe(firstToken);
    // First token must now be rejected (superseded → marked used).
    const stale = await app.post("/auth/reset-password").send({ token: firstToken, new_password: "Whatever123!" });
    expect(stale.status).toBe(400);
    expect(stale.body.error?.code).toBe("reset_token_used");
    // Second token still works.
    const ok = await app.post("/auth/reset-password").send({ token: secondToken, new_password: "Whatever123!" });
    expect(ok.status).toBe(200);
  });

  it("reset-password rejects an expired token", async () => {
    // Issue a fresh token, then force its expiry in the past.
    await app.post("/auth/forgot-password").send({ email });
    const row = await maybeOne<{ id: string }>(
      "select id from password_resets where user_id = (select id from users where email = $1) order by created_at desc limit 1",
      [email],
    );
    await exec("update password_resets set expires_at = now() - interval '1 hour' where id = $1", [row!.id]);
    // Re-extract the latest token from the (mocked) mailer.
    const calls = (sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const latest = calls[calls.length - 1][0];
    const expiredToken = new URL(latest.resetUrl).searchParams.get("token") as string;
    const res = await app.post("/auth/reset-password").send({ token: expiredToken, new_password: newPassword });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("reset_token_expired");
  });
});

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock the mailer so the verification token is captured instead of emailed.
vi.mock("../../src/lib/mailer.js", () => ({
  sendVerificationEmail: vi.fn(async (_: { to: string; verifyUrl: string }) => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}));
import { sendVerificationEmail } from "../../src/lib/mailer.js";

import { app } from "../helpers/app.js";
import { approveSignup } from "../helpers/auth.js";
import { exec, maybeOne } from "../../src/db.js";

describe("email verification (E3)", () => {
  const email = `verify-${Date.now()}@inventory.test`;
  const password = "VerifyPass123!";
  let token = "";

  beforeAll(async () => {
    const res = await app.post("/auth/signup").send({ email, password });
    expect(res.status).toBe(201);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    const call = (sendVerificationEmail as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.to).toBe(email);
    const url = new URL(call.verifyUrl);
    token = url.searchParams.get("token") as string;
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    const u = await maybeOne<{ id: string }>("select id from users where email = $1", [email]);
    if (u) {
      const admin = await import("../helpers/auth.js").then((m) => m.authHeaders("admin"));
      await app.delete(`/users/${u.id}`).set(admin).catch(() => {});
    }
  });

  it("new signups start unverified — login is blocked with 403 email_not_verified", async () => {
    const res = await app.post("/auth/login").send({ email, password });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("email_not_verified");
  });

  it("verify-email confirms the account and login then succeeds", async () => {
    const res = await app.post("/auth/verify-email").send({ token });
    expect(res.status).toBe(200);
    // Verifying proves the address; an admin still has to let the account in.
    await approveSignup(email);
    const login = await app.post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.session?.access_token).toBeTruthy();
  });

  it("verify-email rejects a garbage token with 400 invalid_verify_token", async () => {
    const res = await app.post("/auth/verify-email").send({ token: "not-a-real-token" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_verify_token");
  });

  it("verify-email is idempotent (reuse after confirmation is still 200)", async () => {
    const res = await app.post("/auth/verify-email").send({ token });
    expect(res.status).toBe(200);
  });
});

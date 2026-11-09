import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// The confirmation link is captured rather than emailed.
vi.mock("../../src/lib/mailer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/mailer.js")>()),
  sendPasswordChangeConfirmEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendVerificationEmail: vi.fn(async () => {}),
}));
import {
  sendPasswordChangeConfirmEmail,
  sendPasswordResetEmail,
} from "../../src/lib/mailer.js";

import { app } from "../helpers/app.js";
import { approveSignup } from "../helpers/auth.js";
import { maybeOne } from "../../src/db.js";

/**
 * Choosing the new password up front, and confirming it from the inbox.
 *
 * The point of the order swap: an unauthenticated form may propose a password,
 * but only the person holding the address can make it real. Until they click,
 * the account is untouched — which is what makes the form safe to expose.
 */
describe("password change by confirmation", () => {
  const stamp = Date.now();
  const password = "OldPass123!";
  const proposed = "NewPass456!";
  const ids: string[] = [];

  beforeAll(async () => {
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();
  });

  afterAll(async () => {
    const { authHeaders } = await import("../helpers/auth.js");
    const admin = await authHeaders("admin");
    for (const id of ids) await app.delete(`/users/${id}`).set(admin).catch(() => {});
  });

  /** A usable account: registered, verified, approved. */
  async function account(label: string) {
    const email = `confirm-${label}-${stamp}@inventory.test`;
    const res = await app.post("/auth/signup").send({ email, password });
    expect(res.status).toBe(201);
    ids.push(res.body.user.id);
    await maybeOne("update users set email_confirmed = true where email = $1", [email]);
    await approveSignup(email);
    return email;
  }

  /** The token from the most recent confirmation email. */
  const lastToken = () => {
    const call = vi.mocked(sendPasswordChangeConfirmEmail).mock.calls.at(-1)![0];
    return new URL(call.confirmUrl).searchParams.get("token") as string;
  };

  it("emails a confirm and a refuse link, and changes nothing yet", async () => {
    const email = await account("pending");
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();

    const res = await app
      .post("/auth/forgot-password")
      .send({ email, new_password: proposed });
    expect(res.status).toBe(200);
    expect(sendPasswordChangeConfirmEmail).toHaveBeenCalledTimes(1);

    const call = vi.mocked(sendPasswordChangeConfirmEmail).mock.calls[0][0];
    expect(call.to).toBe(email);
    expect(new URL(call.confirmUrl).pathname).toBe("/reset-password/confirm");
    expect(new URL(call.denyUrl).pathname).toBe("/reset-password/deny");

    // Untouched until confirmed: the old password still signs in, the new one does not.
    expect((await app.post("/auth/login").send({ email, password })).status).toBe(200);
    expect((await app.post("/auth/login").send({ email, password: proposed })).status).toBe(401);
  });

  it("confirming applies the password the requester chose", async () => {
    const email = await account("confirmed");
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();
    await app.post("/auth/forgot-password").send({ email, new_password: proposed });

    const res = await app.post("/auth/confirm-password-reset").send({ token: lastToken() });
    expect(res.status).toBe(200);

    expect((await app.post("/auth/login").send({ email, password: proposed })).status).toBe(200);
    expect((await app.post("/auth/login").send({ email, password })).status).toBe(401);
  });

  it("a confirmation cannot be replayed", async () => {
    const email = await account("replay");
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();
    await app.post("/auth/forgot-password").send({ email, new_password: proposed });
    const token = lastToken();

    expect((await app.post("/auth/confirm-password-reset").send({ token })).status).toBe(200);
    const again = await app.post("/auth/confirm-password-reset").send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("reset_token_used");
  });

  it("refusing leaves the account alone and kills the token", async () => {
    const email = await account("refused");
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();
    await app.post("/auth/forgot-password").send({ email, new_password: proposed });
    const token = lastToken();

    expect((await app.post("/auth/deny-password-reset").send({ token })).status).toBe(200);

    // The old password still works; the proposed one never took.
    expect((await app.post("/auth/login").send({ email, password })).status).toBe(200);
    expect((await app.post("/auth/login").send({ email, password: proposed })).status).toBe(401);

    // And the refused token cannot then be confirmed.
    const late = await app.post("/auth/confirm-password-reset").send({ token });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe("reset_token_denied");
  });

  it("refusing twice is not an error", async () => {
    const email = await account("refused-twice");
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();
    await app.post("/auth/forgot-password").send({ email, new_password: proposed });
    const token = lastToken();

    expect((await app.post("/auth/deny-password-reset").send({ token })).status).toBe(200);
    expect((await app.post("/auth/deny-password-reset").send({ token })).status).toBe(200);
  });

  it("an unknown address is answered the same way, and sends nothing", async () => {
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();
    const res = await app
      .post("/auth/forgot-password")
      .send({ email: `nobody-${stamp}@inventory.test`, new_password: proposed });
    // Same 200 as a real account — the form cannot be used to find out who has one.
    expect(res.status).toBe(200);
    expect(sendPasswordChangeConfirmEmail).not.toHaveBeenCalled();
  });

  it("without a proposed password it still sends the old-style link", async () => {
    // Mobile's code-paste flow and admin invites depend on this shape.
    const email = await account("link-style");
    vi.mocked(sendPasswordResetEmail).mockClear();
    vi.mocked(sendPasswordChangeConfirmEmail).mockClear();

    const res = await app.post("/auth/forgot-password").send({ email });
    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordChangeConfirmEmail).not.toHaveBeenCalled();

    const url = new URL(vi.mocked(sendPasswordResetEmail).mock.calls[0][0].resetUrl);
    expect(url.pathname).toBe("/reset-password");
  });

  it("a link-style token cannot be confirmed — it carries no password", async () => {
    const email = await account("link-confirm");
    vi.mocked(sendPasswordResetEmail).mockClear();
    await app.post("/auth/forgot-password").send({ email });
    const token = new URL(
      vi.mocked(sendPasswordResetEmail).mock.calls[0][0].resetUrl,
    ).searchParams.get("token") as string;

    const res = await app.post("/auth/confirm-password-reset").send({ token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_reset_token");
  });

  it("rejects a password too short to be worth confirming", async () => {
    const res = await app
      .post("/auth/forgot-password")
      .send({ email: `short-${stamp}@inventory.test`, new_password: "abc" });
    expect(res.status).toBe(422);
  });
});

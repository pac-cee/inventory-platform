import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Spy on the notices without sending anything. The rest of the module is kept
// so the verification mail on signup still runs its normal (no-op in test) path.
vi.mock("../../src/lib/mailer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/mailer.js")>()),
  sendAccountApprovedEmail: vi.fn(async () => {}),
  sendAccountCreatedEmail: vi.fn(async () => {}),
  sendPasswordChangedByAdminEmail: vi.fn(async () => {}),
}));

import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { pool } from "../../src/db.js";
import {
  sendAccountApprovedEmail,
  sendAccountCreatedEmail,
  sendPasswordChangedByAdminEmail,
} from "../../src/lib/mailer.js";

/**
 * Registering yourself proves an address, not that you belong here. A
 * self-registered account therefore arrives blocked and pending, and the
 * admin's existing unblock button is what lets it in.
 */
describe("account approval", () => {
  let adminH: Record<string, string>;
  const stamp = Date.now();
  const createdUserIds: string[] = [];
  const PASSWORD = "TestPass123!";

  beforeAll(async () => {
    adminH = await authHeaders("admin");
  });

  afterAll(async () => {
    for (const id of createdUserIds) await app.delete(`/users/${id}`).set(adminH);
  });

  const profileOf = async (id: string) =>
    (
      await pool.query<{ blocked: boolean; approval_status: string; approved_at: string | null }>(
        "select blocked, approval_status, approved_at from profiles where id = $1",
        [id],
      )
    ).rows[0];

  /** Register, then confirm the address so approval is the only thing left. */
  async function selfRegister(label: string) {
    const email = `approval-${label}-${stamp}@inventory.test`;
    const res = await app
      .post("/auth/signup")
      .send({ email, password: PASSWORD, full_name: "Self Signup" });
    expect(res.status).toBe(201);
    const id = res.body.user.id as string;
    createdUserIds.push(id);
    await pool.query("update users set email_confirmed = true where id = $1", [id]);
    return { id, email };
  }

  it("a self-registered account starts blocked and pending", async () => {
    const { id } = await selfRegister("fresh");
    const profile = await profileOf(id);
    expect(profile.approval_status).toBe("pending");
    expect(profile.blocked).toBe(true);
    expect(profile.approved_at).toBeNull();
  });

  it("it cannot sign in, and is told it is waiting rather than blocked", async () => {
    const { email } = await selfRegister("waiting");
    const res = await app.post("/auth/login").send({ email, password: PASSWORD });
    expect(res.status).toBe(403);
    // Both flags are set on a fresh signup; "blocked" would be the misleading one.
    expect(res.body.error.code).toBe("account_pending_approval");
  });

  it("unblocking approves it, emails the person, and lets them in", async () => {
    const { id, email } = await selfRegister("approved");
    vi.mocked(sendAccountApprovedEmail).mockClear();

    const res = await app.patch(`/users/${id}/block`).set(adminH).send({ blocked: false });
    expect(res.status).toBe(200);

    const profile = await profileOf(id);
    expect(profile.approval_status).toBe("approved");
    expect(profile.blocked).toBe(false);
    expect(profile.approved_at).not.toBeNull();

    expect(sendAccountApprovedEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAccountApprovedEmail).mock.calls[0][0]).toMatchObject({ to: email });

    const login = await app.post("/auth/login").send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.session.access_token).toBeTruthy();
  });

  it("a later unblock is an ordinary unblock, not a second approval", async () => {
    const { id, email } = await selfRegister("reblocked");
    await app.patch(`/users/${id}/block`).set(adminH).send({ blocked: false });

    // Blocked again after approval: the message is now the blocked one.
    await app.patch(`/users/${id}/block`).set(adminH).send({ blocked: true });
    const denied = await app.post("/auth/login").send({ email, password: PASSWORD });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("account_blocked");

    vi.mocked(sendAccountApprovedEmail).mockClear();
    await app.patch(`/users/${id}/block`).set(adminH).send({ blocked: false });
    expect(sendAccountApprovedEmail).not.toHaveBeenCalled();
    expect((await profileOf(id)).approval_status).toBe("approved");
  });

  it("an admin-created account needs no approval", async () => {
    const email = `approval-admin-made-${stamp}@inventory.test`;
    const res = await app
      .post("/users")
      .set(adminH)
      .send({ email, password: PASSWORD, full_name: "Made By Admin" });
    expect(res.status).toBe(201);
    createdUserIds.push(res.body.user.id);

    const profile = await profileOf(res.body.user.id);
    expect(profile.approval_status).toBe("approved");
    expect(profile.blocked).toBe(false);

    const login = await app.post("/auth/login").send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
  });
});

/** The two notices that carry a password an admin chose. */
describe("password notices", () => {
  let adminH: Record<string, string>;
  const stamp = Date.now();
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    adminH = await authHeaders("admin");
  });

  afterAll(async () => {
    for (const id of createdUserIds) await app.delete(`/users/${id}`).set(adminH);
  });

  it("creating an account with a password emails it to the person", async () => {
    vi.mocked(sendAccountCreatedEmail).mockClear();
    const email = `notice-created-${stamp}@inventory.test`;
    const res = await app
      .post("/users")
      .set(adminH)
      .send({ email, password: "TestPass123!", full_name: "Told Directly" });
    expect(res.status).toBe(201);
    createdUserIds.push(res.body.user.id);

    expect(res.body.invited).toBe(false);
    expect(sendAccountCreatedEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAccountCreatedEmail).mock.calls[0][0]).toMatchObject({
      to: email,
      password: "TestPass123!",
    });
  });

  it("leaving the password out still invites instead of emailing one", async () => {
    vi.mocked(sendAccountCreatedEmail).mockClear();
    const email = `notice-invited-${stamp}@inventory.test`;
    const res = await app.post("/users").set(adminH).send({ email });
    expect(res.status).toBe(201);
    createdUserIds.push(res.body.user.id);

    expect(res.body.invited).toBe(true);
    expect(sendAccountCreatedEmail).not.toHaveBeenCalled();
  });

  it("an admin changing someone's password emails them the new one", async () => {
    const email = `notice-changed-${stamp}@inventory.test`;
    const created = await app
      .post("/users")
      .set(adminH)
      .send({ email, password: "TestPass123!", full_name: "Password Changed" });
    createdUserIds.push(created.body.user.id);

    vi.mocked(sendPasswordChangedByAdminEmail).mockClear();
    const res = await app
      .patch(`/users/${created.body.user.id}`)
      .set(adminH)
      .send({ password: "BrandNewPass456!" });
    expect(res.status).toBe(200);

    expect(sendPasswordChangedByAdminEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendPasswordChangedByAdminEmail).mock.calls[0][0]).toMatchObject({
      to: email,
      password: "BrandNewPass456!",
    });

    // And the new password is the one that works.
    const login = await app.post("/auth/login").send({ email, password: "BrandNewPass456!" });
    expect(login.status).toBe(200);
  });

  it("changing only the name sends nothing", async () => {
    const email = `notice-renamed-${stamp}@inventory.test`;
    const created = await app
      .post("/users")
      .set(adminH)
      .send({ email, password: "TestPass123!" });
    createdUserIds.push(created.body.user.id);

    vi.mocked(sendPasswordChangedByAdminEmail).mockClear();
    await app.patch(`/users/${created.body.user.id}`).set(adminH).send({ full_name: "Renamed" });
    expect(sendPasswordChangedByAdminEmail).not.toHaveBeenCalled();
  });
});

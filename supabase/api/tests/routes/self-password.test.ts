import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * A member changes their own password without an admin touching it.
 *
 * The route is not admin-gated and Settings has no role check, but nothing
 * proved that for a member specifically — an accidental requireAdmin on
 * /auth/change-password would have sent every password change back through an
 * administrator, which is the thing this is meant to avoid.
 *
 * A dedicated account is created for this: changing the shared member fixture's
 * password would break every other file in the run.
 */
describe("a member changes their own password", () => {
  let adminH: Record<string, string>;
  const stamp = Date.now();
  const email = `self-password-${stamp}@inventory.test`;
  const FIRST = "FirstPass123!";
  const SECOND = "SecondPass456!";
  let userId: string;
  let memberH: Record<string, string>;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    const created = await app
      .post("/users")
      .set(adminH)
      .send({ email, password: FIRST, full_name: "Self Service", role: "member" });
    expect(created.status).toBe(201);
    userId = created.body.user.id;

    const login = await app.post("/auth/login").send({ email, password: FIRST });
    expect(login.status).toBe(200);
    memberH = { Authorization: `Bearer ${login.body.session.access_token}` };
  });

  afterAll(async () => {
    await app.delete(`/users/${userId}`).set(adminH);
  });

  it("refuses when the current password is wrong", async () => {
    const res = await app
      .post("/auth/change-password")
      .set(memberH)
      .send({ current_password: "NotMyPassword!", new_password: SECOND });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_current_password");

    // And the real password still works.
    expect((await app.post("/auth/login").send({ email, password: FIRST })).status).toBe(200);
  });

  it("changes it with no admin involved", async () => {
    const res = await app
      .post("/auth/change-password")
      .set(memberH)
      .send({ current_password: FIRST, new_password: SECOND });
    expect(res.status).toBe(204);
  });

  it("the new password works and the old one does not", async () => {
    expect((await app.post("/auth/login").send({ email, password: SECOND })).status).toBe(200);
    expect((await app.post("/auth/login").send({ email, password: FIRST })).status).toBe(401);
  });

  it("needs a session — it is not a public route", async () => {
    const res = await app
      .post("/auth/change-password")
      .send({ current_password: SECOND, new_password: "ThirdPass789!" });
    expect(res.status).toBe(401);
  });
});

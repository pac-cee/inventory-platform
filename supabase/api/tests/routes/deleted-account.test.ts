import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * A deleted account must stop working immediately.
 *
 * The access token is a signed JWT with an hour of life and no way to withdraw
 * it, so nothing about deletion invalidates the token itself. The check has to
 * happen per request, against the account. It previously did not: requireAuth
 * tested `profile?.blocked`, and a deleted user has no profile row at all, so
 * `undefined` sailed past the block check and kept full read access until the
 * token expired on its own.
 */
describe("a deleted account", () => {
  let adminH: Record<string, string>;
  const stamp = Date.now();
  const email = `deleted-${stamp}@inventory.test`;
  const password = "TestPass123!";
  let userId: string;
  let ghostH: Record<string, string>;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    const created = await app
      .post("/users")
      .set(adminH)
      .send({ email, password, full_name: "About To Go", role: "member" });
    expect(created.status).toBe(201);
    userId = created.body.user.id;

    const login = await app.post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    ghostH = { Authorization: `Bearer ${login.body.session.access_token}` };
    // Kept to prove the refresh path closes too.
    refreshToken = login.body.session.refresh_token;
  });

  let refreshToken = "";

  afterAll(async () => {
    // Already gone in the happy path; harmless if a test failed early.
    await app.delete(`/users/${userId}`).set(adminH).catch(() => {});
  });

  it("works right up until the moment it is deleted", async () => {
    expect((await app.get("/items").set(ghostH)).status).toBe(200);
    expect((await app.delete(`/users/${userId}`).set(adminH)).status).toBe(204);
  });

  it("cannot read anything with the token it already holds", async () => {
    for (const path of ["/items", "/locations", "/stock", "/auth/me", "/profiles"]) {
      const res = await app.get(path).set(ghostH);
      expect(res.status, `${path} should be closed to a deleted account`).toBe(401);
      expect(res.body.error.code).toBe("account_not_found");
    }
  });

  it("cannot write either", async () => {
    const res = await app.post("/movements").set(ghostH).send({
      item_id: "00000000-0000-0000-0000-000000000000",
      location_id: "00000000-0000-0000-0000-000000000000",
      quantity: 1,
      reason: "initial",
    });
    expect(res.status).toBe(401);
  });

  it("cannot trade its refresh token for a fresh session", async () => {
    // The refresh row cascades away with the user, so the session cannot be
    // renewed either — 401 is the end of it, not a detour through /refresh.
    const res = await app.post("/auth/refresh").send({ refresh_token: refreshToken });
    expect(res.status).toBe(401);
  });

  it("cannot sign in again", async () => {
    const res = await app.post("/auth/login").send({ email, password });
    expect(res.status).toBe(401);
  });
});

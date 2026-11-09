import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * Revoking a session has to mean something to the access token.
 *
 * The access token is a signed JWT with an hour of life and no way to recall
 * it. Everything that "ends a session" — signing out, being blocked, any
 * password change — only revokes refresh tokens, so unless the session is
 * checked on each request, the browser keeps a working key for up to another
 * hour after being signed out.
 */
describe("session revocation", () => {
  let adminH: Record<string, string>;
  const stamp = Date.now();
  const password = "TestPass123!";
  const created: string[] = [];

  beforeAll(async () => {
    adminH = await authHeaders("admin");
  });

  afterAll(async () => {
    for (const id of created) await app.delete(`/users/${id}`).set(adminH).catch(() => {});
  });

  /** A fresh account nobody else is using, plus a signed-in session for it. */
  async function signedIn(label: string) {
    const email = `session-${label}-${stamp}@inventory.test`;
    const res = await app
      .post("/users")
      .set(adminH)
      .send({ email, password, full_name: "Session Test", role: "member" });
    expect(res.status).toBe(201);
    created.push(res.body.user.id);
    const login = await app.post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    return {
      id: res.body.user.id as string,
      email,
      headers: { Authorization: `Bearer ${login.body.session.access_token}` },
      refresh: login.body.session.refresh_token as string,
    };
  }

  it("signing out kills the access token immediately", async () => {
    const user = await signedIn("logout");
    expect((await app.get("/items").set(user.headers)).status).toBe(200);

    expect((await app.post("/auth/logout").set(user.headers)).status).toBe(204);

    const after = await app.get("/items").set(user.headers);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("session_revoked");
  });

  it("a signed-out session cannot be refreshed back to life", async () => {
    const user = await signedIn("logout-refresh");
    await app.post("/auth/logout").set(user.headers);
    expect((await app.post("/auth/refresh").send({ refresh_token: user.refresh })).status).toBe(401);
  });

  it("blocking ends the sessions the account already had", async () => {
    const user = await signedIn("blocked");
    expect((await app.get("/items").set(user.headers)).status).toBe(200);

    await app.patch(`/users/${user.id}/block`).set(adminH).send({ blocked: true });

    const after = await app.get("/items").set(user.headers);
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe("account_blocked");
  });

  it("an admin resetting a password signs out whoever held the account", async () => {
    const user = await signedIn("admin-reset");
    expect((await app.get("/items").set(user.headers)).status).toBe(200);

    await app.patch(`/users/${user.id}`).set(adminH).send({ password: "AdminSet456!" });

    // The point of the reset: the old session goes with the old password.
    const after = await app.get("/items").set(user.headers);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("session_revoked");
  });

  it("changing your own password keeps you signed in but ends every other session", async () => {
    const user = await signedIn("self-change");
    const second = await app.post("/auth/login").send({ email: user.email, password });
    const otherH = { Authorization: `Bearer ${second.body.session.access_token}` };
    expect((await app.get("/items").set(otherH)).status).toBe(200);

    const res = await app
      .post("/auth/change-password")
      .set(user.headers)
      .send({ current_password: password, new_password: "SelfChosen789!" });
    expect(res.status).toBe(204);

    // Still signed in where it was done…
    expect((await app.get("/items").set(user.headers)).status).toBe(200);
    // …and signed out everywhere else.
    const otherAfter = await app.get("/items").set(otherH);
    expect(otherAfter.status).toBe(401);
    expect(otherAfter.body.error.code).toBe("session_revoked");
  });

  it("an ordinary session is untouched by someone else's revocation", async () => {
    const mine = await signedIn("bystander-a");
    const theirs = await signedIn("bystander-b");
    await app.post("/auth/logout").set(theirs.headers);
    expect((await app.get("/items").set(mine.headers)).status).toBe(200);
  });
});

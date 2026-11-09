import { describe, it, expect, beforeAll, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { pool } from "../../src/db.js";

/**
 * Admin-created accounts are invited rather than handed a password.
 *
 * Before this, POST /users took a password, marked the address confirmed
 * without proving it, and told the user nothing — so a typo produced a working
 * account nobody could reach, and the password had to be passed along by hand.
 */
describe("admin creates an account", () => {
  let adminH: Record<string, string>;
  const stamp = Date.now();

  beforeAll(async () => {
    adminH = await authHeaders("admin");
  });

  const tokenRowsFor = async (email: string) => {
    const { rows } = await pool.query(
      `select r.id, r.used_at, r.expires_at
         from password_resets r join users u on u.id = r.user_id
        where u.email = $1`,
      [email],
    );
    return rows;
  };

  it("issues a set-password token when no password is given", async () => {
    const email = `invite-${stamp}@inventory.test`;
    const res = await app.post("/users").set(adminH).send({ email, full_name: "Invited" });
    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(true);

    // The invite rides on the password-reset table — one code path, not two.
    const tokens = await tokenRowsFor(email);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].used_at).toBeNull();
    expect(new Date(tokens[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("the invited account cannot be signed into until the link is used", async () => {
    const email = `invite-locked-${stamp}@inventory.test`;
    await app.post("/users").set(adminH).send({ email });

    // The placeholder password is random, so nothing plausible works.
    for (const password of ["password", "123456", ""]) {
      const res = await app.post("/auth/login").send({ email, password });
      expect(res.status).not.toBe(200);
    }
  });

  it("still accepts an explicit password, and does not invite then", async () => {
    const email = `invite-none-${stamp}@inventory.test`;
    const res = await app
      .post("/users")
      .set(adminH)
      .send({ email, password: "ChosenPass123!" });
    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(false);
    expect(await tokenRowsFor(email)).toHaveLength(0);

    const login = await app.post("/auth/login").send({ email, password: "ChosenPass123!" });
    expect(login.status).toBe(200);
  });

  it("rejects a password that is too short", async () => {
    const res = await app
      .post("/users")
      .set(adminH)
      .send({ email: `invite-short-${stamp}@inventory.test`, password: "abc" });
    expect(res.status).toBe(422);
  });

  it("still refuses a duplicate address", async () => {
    const email = `invite-dup-${stamp}@inventory.test`;
    expect((await app.post("/users").set(adminH).send({ email })).status).toBe(201);
    expect((await app.post("/users").set(adminH).send({ email })).status).toBe(400);
  });
});

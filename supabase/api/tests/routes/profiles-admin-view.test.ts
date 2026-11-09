import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * An admin deciding whether to approve an account has to know the person
 * finished their half of it. Without the confirmation flag on this list,
 * "waiting for approval" is indistinguishable from "waiting for them".
 *
 * Members get names only: the list exists for them to turn ids into names in
 * the activity log, and handing every member a roster of addresses is not part
 * of that.
 */
describe("GET /profiles", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  const stamp = Date.now();
  const email = `profile-view-${stamp}@inventory.test`;
  let userId: string;

  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    const res = await app
      .post("/users")
      .set(adminH)
      .send({ email, password: "TestPass123!", full_name: "Profile View" });
    expect(res.status).toBe(201);
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await app.delete(`/users/${userId}`).set(adminH);
  });

  it("tells an admin the address and whether it is confirmed", async () => {
    const res = await app.get("/profiles").set(adminH);
    expect(res.status).toBe(200);
    const row = res.body.find((p: { id: string }) => p.id === userId);
    expect(row.email).toBe(email);
    // Created by an admin, so the address is vouched for already.
    expect(row.email_confirmed).toBe(true);
  });

  it("tells a member neither", async () => {
    const res = await app.get("/profiles").set(memberH);
    expect(res.status).toBe(200);
    const row = res.body.find((p: { id: string }) => p.id === userId);
    expect(row).toBeTruthy();
    expect(row.full_name).toBe("Profile View");
    expect(row.email).toBeUndefined();
    expect(row.email_confirmed).toBeUndefined();
  });

  it("still carries the approval state an admin acts on", async () => {
    const res = await app.get("/profiles").set(adminH);
    const row = res.body.find((p: { id: string }) => p.id === userId);
    expect(row.approval_status).toBe("approved");
    expect(row.blocked).toBe(false);
  });
});

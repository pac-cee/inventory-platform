import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

// GET /payments/drive-check: the admin's way to see why receipts will not upload.
describe("drive check route", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("an admin sees which setting is missing, and no Google call is made", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    vi.stubEnv("GOOGLE_OAUTH_REFRESH_TOKEN", "");
    const res = await app.get("/payments/drive-check").set(adminH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.configured).toEqual({ client_id: false, client_secret: false, refresh_token: false });
    expect(res.body.steps[0]).toMatchObject({ step: "credentials", ok: false, reason: "not_configured" });
    expect(res.body.steps[0].fix).toMatch(/GOOGLE_OAUTH_REFRESH_TOKEN/);
  });

  it("members cannot run it, and it needs a login", async () => {
    expect((await app.get("/payments/drive-check").set(memberH)).status).toBe(403);
    expect((await app.get("/payments/drive-check")).status).toBe(401);
  });
});

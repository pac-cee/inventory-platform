import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { momo } from "../../src/lib/momo.js";

// The number MTN (and UrubutoPay) need for their IP allow-list, and the reason a
// balance check fails when the IP is not on it.
describe("egress IP and the MoMo balance check", () => {
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  beforeAll(async () => {
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("an admin gets the server's public IP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ip: "203.0.113.7" }) })));
    const res = await app.get("/payments/egress-ip").set(adminH);
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe("203.0.113.7");
    expect(res.body.note).toMatch(/static outbound IP/);
  });

  it("falls back to the second lookup service when the first fails", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ip: "2001:db8::1" }) });
    vi.stubGlobal("fetch", f);
    expect((await app.get("/payments/egress-ip").set(adminH)).body.ip).toBe("2001:db8::1");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("502 with a clear code when neither answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const res = await app.get("/payments/egress-ip").set(adminH);
    expect(res.status).toBe(502);
    expect(res.body.error?.code).toBe("egress_ip_unavailable");
  });

  it("members cannot ask", async () => {
    expect((await app.get("/payments/egress-ip").set(memberH)).status).toBe(403);
  });

  it("the MoMo balance route shows MTN's reason to an admin (here: IP not allowed)", async () => {
    vi.spyOn(momo, "getAccountBalance").mockRejectedValue(
      Object.assign(new Error("MoMo balance request rejected (403): MTN refused this server's IP address."), { status: 403 }),
    );
    const res = await app.get("/payments/balance").set(adminH);
    expect(res.status).toBe(502);
    expect(res.body.error?.message).toMatch(/IP address/);
    expect(res.body.error?.code).toBe("momo_balance_error");
  });
});

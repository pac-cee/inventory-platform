import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockRequest, MockError } = await import("./index");
type Data = import("./index").Data;

/**
 * Mock mode is the whole backend for the shareable prototype. These pin what a
 * visitor relies on: signing in, recorded data coming back, and their own
 * edits showing up on the next read.
 */

describe("mockRequest", () => {
  it("signs in with any credentials and hands back a long-lived session", async () => {
    const res = await mockRequest<Data>("POST", "/auth/login", { email: "x@y.z", password: "anything" });
    expect(res.session.access_token).toBeTruthy();
    expect(res.session.expires_at).toBeGreaterThan(Date.now() / 1000 + 86400);
  });

  it("serves the recorded catalog and filters it by search", async () => {
    const all = await mockRequest<Data[]>("GET", "/items?limit=200&offset=0");
    expect(all.length).toBeGreaterThan(10);
    const cameras = await mockRequest<Data[]>("GET", "/items?search=gopro&limit=30");
    expect(cameras.map((i) => i.name)).toEqual(["GoPro Hero 12"]);
  });

  it("keeps created, edited and deleted items for later reads", async () => {
    const created = await mockRequest<Data>("POST", "/items", { type: "Cable", name: "Mock Lead", model: "M1" });
    expect(await mockRequest<Data>("GET", `/items/${created.id}`)).toMatchObject({ name: "Mock Lead" });

    await mockRequest("PATCH", `/items/${created.id}`, { name: "Renamed Lead" });
    expect(await mockRequest<Data>("GET", `/items/${created.id}`)).toMatchObject({ name: "Renamed Lead" });

    await mockRequest("DELETE", `/items/${created.id}`);
    await expect(mockRequest("GET", `/items/${created.id}`)).rejects.toBeInstanceOf(MockError);
  });

  it("answers an unrecorded id on a known route with an empty list, not an error", async () => {
    const holders = await mockRequest<Data[]>("GET", "/items/00000000-0000-0000-0000-000000000000/holders");
    expect(holders).toEqual([]);
  });

  it("refuses an unknown box code", async () => {
    await expect(mockRequest("GET", "/locations/by-token/NOPE")).rejects.toMatchObject({ status: 404 });
  });

  it("does not let one caller's edits leak through a shared reference", async () => {
    const first = await mockRequest<Data[]>("GET", "/profiles");
    first[0].full_name = "Changed by caller";
    const again = await mockRequest<Data[]>("GET", "/profiles");
    expect(again[0].full_name).not.toBe("Changed by caller");
  });
});

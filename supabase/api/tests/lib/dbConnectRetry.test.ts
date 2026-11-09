import { describe, it, expect, vi, afterEach } from "vitest";
import { pool, connectWithRetry, rows } from "../../src/db.js";

// Connection-phase failures are retried (nothing has run yet, so it is safe);
// anything else is not.
afterEach(() => vi.restoreAllMocks());

const fakeClient = (r: unknown[]) =>
  ({ query: async () => ({ rows: r, rowCount: r.length }), release: () => {} }) as any;

describe("connectWithRetry", () => {
  it("retries a connect timeout and then succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi
      .spyOn(pool, "connect")
      .mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"))
      .mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))
      .mockResolvedValue(fakeClient([{ a: 1 }]) as never);
    await expect(rows("select 1")).resolves.toEqual([{ a: 1 }]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempts and throws the last error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(pool, "connect").mockRejectedValue(new Error("Connection terminated unexpectedly"));
    await expect(connectWithRetry(3)).rejects.toThrow(/Connection terminated/);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does not retry an error that is not a connection failure", async () => {
    const spy = vi.spyOn(pool, "connect").mockRejectedValue(new Error("password authentication failed"));
    await expect(connectWithRetry(3)).rejects.toThrow(/password authentication/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("has an error listener, so a dropped idle connection cannot crash the process", () => {
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
  });
});

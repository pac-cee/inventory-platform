import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkEmailLockout,
  recordFailedLogin,
  clearLoginAttempts,
} from "../../src/lib/loginLockout.js";
import { HttpError } from "../../src/http.js";

const EMAIL = "brute@attempt.test";

describe("loginLockout", () => {
  beforeEach(() => clearLoginAttempts(EMAIL));
  afterEach(() => {
    clearLoginAttempts(EMAIL);
    vi.useRealTimers();
  });

  it("does not throw before the failure threshold", () => {
    for (let i = 1; i < 5; i++) recordFailedLogin(EMAIL);
    expect(() => checkEmailLockout(EMAIL)).not.toThrow();
  });

  it("throws 429 TOO_MANY_REQUESTS on the 6th failed attempt (5 failures)", () => {
    for (let i = 0; i < 5; i++) recordFailedLogin(EMAIL);
    let caught: unknown;
    try {
      checkEmailLockout(EMAIL);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    const err = caught as HttpError;
    expect(err.status).toBe(429);
    expect(err.code).toBe("TOO_MANY_REQUESTS");
  });

  it("clears the lockout on successful login", () => {
    for (let i = 0; i < 5; i++) recordFailedLogin(EMAIL);
    expect(() => checkEmailLockout(EMAIL)).toThrow();
    clearLoginAttempts(EMAIL);
    expect(() => checkEmailLockout(EMAIL)).not.toThrow();
  });

  it("auto-expires the lockout after the 15-minute window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < 5; i++) recordFailedLogin(EMAIL);
    expect(() => checkEmailLockout(EMAIL)).toThrow();

    // Advance just past the 15-minute lockout window.
    vi.setSystemTime(new Date("2026-01-01T00:15:01Z"));
    expect(() => checkEmailLockout(EMAIL)).not.toThrow();
  });

  it("tracks emails independently", () => {
    for (let i = 0; i < 5; i++) recordFailedLogin(EMAIL);
    const other = "other@attempt.test";
    expect(() => checkEmailLockout(other)).not.toThrow();
    expect(() => checkEmailLockout(EMAIL)).toThrow();
  });

  // Sub-threshold entries were never evicted — they accumulated forever, and the
  // key is caller-supplied, so /login with random addresses grew the map without
  // bound. Eviction isn't directly observable, so assert it via the counter:
  // a swept entry starts over instead of resuming its old failure count.
  it("forgets stale sub-threshold failures after the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < 4; i++) recordFailedLogin(EMAIL);

    // Long after the window, one more failure must not be treated as the 5th.
    vi.setSystemTime(new Date("2026-01-01T00:16:00Z"));
    recordFailedLogin(EMAIL);
    expect(() => checkEmailLockout(EMAIL)).not.toThrow();

    // And the fresh counter still locks once it reaches the threshold on its own.
    for (let i = 0; i < 4; i++) recordFailedLogin(EMAIL);
    expect(() => checkEmailLockout(EMAIL)).toThrow();
  });

  it("sweeps other stale emails when any failure is recorded", () => {
    const other = "stale@attempt.test";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < 4; i++) recordFailedLogin(other);

    // A failure for an unrelated email triggers the sweep.
    vi.setSystemTime(new Date("2026-01-01T00:16:00Z"));
    recordFailedLogin(EMAIL);

    // `other` was dropped, so its next failure is #1 — not the locking #5.
    recordFailedLogin(other);
    expect(() => checkEmailLockout(other)).not.toThrow();
    clearLoginAttempts(other);
  });
});

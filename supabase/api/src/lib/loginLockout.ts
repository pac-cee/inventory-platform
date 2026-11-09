// ---------------------------------------------------------------------------
// loginLockout — per-email brute-force backoff for /auth/login.
//
// In-memory: sufficient for the current single Railway instance. If the API
// ever scales horizontally, swap the Map for Redis (same interface).
//
// Behaviour:
//   • recordFailedLogin(email) — +1 failure; locks for LOCKOUT_MS at threshold.
//   • checkEmailLockout(email) — throws HttpError 429 while locked.
//   • clearLoginAttempts(email) — reset on successful login.
// ---------------------------------------------------------------------------

import { HttpError } from "../http.js";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface LockoutEntry {
  failures: number;
  lockedUntil: number | null; // epoch ms, or null if not locked
  lastFailureAt: number; // epoch ms — drives eviction of stale entries
}

const attempts = new Map<string, LockoutEntry>();

/**
 * Drop entries whose last failure is older than the lockout window. Without
 * this, an email that fails 1–4 times and never succeeds is kept forever, and
 * the key is caller-supplied — so anyone hitting /login with random addresses
 * grows the map without bound. Also gives an honest fresh window to a user who
 * simply mistyped their password some hours ago.
 */
function evictStale(now: number): void {
  for (const [email, entry] of attempts) {
    const expiry = entry.lockedUntil ?? entry.lastFailureAt + LOCKOUT_MS;
    if (now >= expiry) attempts.delete(email);
  }
}

/** Throw 429 if the email is currently locked out. */
export function checkEmailLockout(email: string): void {
  const entry = attempts.get(email);
  if (!entry || entry.lockedUntil === null) return;
  if (Date.now() < entry.lockedUntil) {
    const retryAfterMin = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new HttpError(
      429,
      `Too many failed attempts. Try again in ${retryAfterMin} minute(s).`,
      "TOO_MANY_REQUESTS",
    );
  }
  // Window elapsed but still flagged — clear so a fresh counter starts.
  attempts.delete(email);
}

/** Record one failed login; lock the email once it hits MAX_FAILURES. */
export function recordFailedLogin(email: string): void {
  const now = Date.now();
  // Sweep on write — failures are the only thing that grows the map, so this is
  // the cheapest place to keep it bounded.
  evictStale(now);
  const entry = attempts.get(email) ?? { failures: 0, lockedUntil: null, lastFailureAt: now };
  entry.failures += 1;
  entry.lastFailureAt = now;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(email, entry);
}

/** Clear all recorded failures for an email (called on successful login). */
export function clearLoginAttempts(email: string): void {
  attempts.delete(email);
}

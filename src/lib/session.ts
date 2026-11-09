import "server-only";
import { cookies } from "next/headers";
import type { Session } from "@/lib/api/types";

// httpOnly cookies that hold the API-issued session. The browser never sees the
// tokens directly — all API calls happen server-side (see lib/api/server.ts).
export const ACCESS_COOKIE = "sb-access-token";
export const REFRESH_COOKIE = "sb-refresh-token";
export const EXPIRES_COOKIE = "sb-expires-at";

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/** Decode a JWT's `exp` (unix seconds) without verifying — used only for expiry checks. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** Persist a session into httpOnly cookies. Only valid in a Server Action / Route Handler. */
export async function setSession(session: Session): Promise<void> {
  const store = await cookies();
  const expiresAt =
    session.expires_at ?? jwtExpiry(session.access_token) ?? Math.floor(Date.now() / 1000) + 3600;

  store.set(ACCESS_COOKIE, session.access_token, baseCookieOptions);
  store.set(REFRESH_COOKIE, session.refresh_token, baseCookieOptions);
  store.set(EXPIRES_COOKIE, String(expiresAt), baseCookieOptions);
}

/** Clear the session cookies. Only valid in a Server Action / Route Handler. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  store.delete(EXPIRES_COOKIE);
}

/** The current access token from cookies, or null. Refresh is handled by proxy.ts. */
export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

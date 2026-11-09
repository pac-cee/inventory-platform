import { NextResponse, type NextRequest } from "next/server";

// Kept in sync with lib/session.ts. Inlined here (rather than imported) so this
// module stays free of the `server-only` / next/headers coupling that the
// proxy runtime doesn't allow.
const ACCESS_COOKIE = "sb-access-token";
const REFRESH_COOKIE = "sb-refresh-token";
const EXPIRES_COOKIE = "sb-expires-at";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

interface Session {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

function jwtExpiry(token: string): number | null {
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

async function refresh(refreshToken: string): Promise<Session | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { session: Session | null };
    return data.session;
  } catch {
    return null;
  }
}

/**
 * Runs on every matched request (see proxy.ts). Validates the session cookie,
 * transparently refreshes it when expired, and gates protected vs. auth routes
 * — the same responsibilities the old @supabase/ssr middleware had.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const expiresAt = Number(request.cookies.get(EXPIRES_COOKIE)?.value ?? 0);

  let authenticated = false;

  if (accessToken) {
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = expiresAt || jwtExpiry(accessToken) || 0;
    const expired = exp !== 0 && exp - nowSec < 60; // refresh ~1 min before expiry

    if (!expired) {
      authenticated = true;
    } else if (refreshToken) {
      const session = await refresh(refreshToken);
      if (session) {
        const newExp =
          session.expires_at ?? jwtExpiry(session.access_token) ?? nowSec + 3600;
        response.cookies.set(ACCESS_COOKIE, session.access_token, cookieOptions);
        response.cookies.set(REFRESH_COOKIE, session.refresh_token, cookieOptions);
        response.cookies.set(EXPIRES_COOKIE, String(newExp), cookieOptions);
        authenticated = true;
      }
    }
  }

  // If a stale token couldn't be refreshed, clear it.
  if (accessToken && !authenticated) {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    response.cookies.delete(EXPIRES_COOKIE);
  }

  const pathname = request.nextUrl.pathname;
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/verify") ||
    pathname.startsWith("/reset-password") ||
    // Asking for a reset is necessarily done by someone who cannot sign in.
    pathname.startsWith("/forgot-password") ||
    // Clears the cookies of a session the API has already rejected. It must be
    // reachable while those cookies are still present, which is the whole point
    // of it — see app/session-ended/route.ts.
    pathname.startsWith("/session-ended");

  if (!authenticated && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (authenticated && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

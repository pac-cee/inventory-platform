import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, EXPIRES_COOKIE } from "@/lib/session";

/**
 * Where a page goes when the API says the session is over.
 *
 * The cookies have to be dropped, and a server component cannot drop them —
 * only a route handler or a server action may write cookies. Redirecting
 * straight to /login instead left them in place, and the middleware treats a
 * present, unexpired cookie as signed in, so it bounced back to the app, which
 * 401'd again: an endless / → /login → / loop in the browser.
 *
 * Signing out normally still goes through signOut(); this is the involuntary
 * path — revoked, blocked, deleted, or password changed elsewhere.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set(
    "message",
    "Your session has ended. Please sign in again.",
  );

  const response = NextResponse.redirect(url);
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, EXPIRES_COOKIE]) {
    response.cookies.delete(name);
  }
  return response;
}

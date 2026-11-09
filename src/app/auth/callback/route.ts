import { NextResponse } from "next/server";

// Auth is now routed through the inventory-api using email + password, so there
// is no PKCE/OAuth code to exchange here. Supabase email-confirmation links land
// here; we simply send the user to the login page. (See supabase/api for the
// auth endpoints; a dedicated /auth/exchange would be needed to support OAuth.)
export function GET(request: Request) {
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/login?message=Email confirmed — please sign in`);
}

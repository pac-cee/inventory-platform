import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

/**
 * Open an admin-only API check in the browser, using the signed-in admin's own
 * session (the API itself enforces "admin only" and answers 403 to anyone else).
 * Shown as indented JSON so it reads as a page, not a download.
 */
export async function diagnosticResponse(apiPath: string) {
  try {
    const data = await serverApi().get<unknown>(apiPath);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Request failed";
    if (status >= 500 && !(error instanceof ApiError)) console.error(`GET ${apiPath} failed:`, error);
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/session";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/**
 * Proxy a photo from the API — shared by items (0034) and locations (0036).
 *
 * The <img> tag cannot send the session token, so the browser asks Next and
 * Next asks the API. `redirect: "manual"` matters: when there is no upload the
 * API answers 302 to an external photo_url, and following that here would make
 * this server fetch someone else's host and stream it back.
 */
export async function proxyPhoto(kind: "items" | "locations", id: string): Promise<Response> {
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/${kind}/${id}/photo`, {
      headers,
      cache: "no-store",
      redirect: "manual",
    });

    // No upload — hand the browser the external link and let it fetch that.
    const location = res.headers.get("location");
    if (res.status === 302 && location) {
      return NextResponse.redirect(location, 302);
    }
    if (!res.ok) {
      return NextResponse.json({ error: "No photo." }, { status: res.status });
    }

    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error(`GET /api/${kind}/${id}/photo failed:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

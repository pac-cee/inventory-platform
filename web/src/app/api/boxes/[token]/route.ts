import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

/** A scanned box code → the box and what is in it (the API does the lookup). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const api = serverApi();
    return NextResponse.json(await api.get(`/locations/by-token/${encodeURIComponent(token)}`));
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = status === 404 ? "No box has that code." : status === 422 ? "That is not a valid box code." : "Could not look up that box.";
    if (status >= 500) console.error("GET /api/boxes failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

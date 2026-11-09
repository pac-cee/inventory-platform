import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

/**
 * The signed-in person's own loans, for the "Equipment due" bell. A manager's
 * /movements/borrowed lists everyone's, so ask for this person explicitly.
 */
export async function GET() {
  try {
    const api = serverApi();
    const me = await api.get<{ user: { id: string } }>("/auth/me");
    const loans = await api.get<unknown[]>(`/movements/borrowed?user_id=${me.user.id}`);
    return NextResponse.json(loans);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status >= 500) console.error("GET /api/loans failed:", error);
    return NextResponse.json({ error: "Could not load loans" }, { status });
  }
}

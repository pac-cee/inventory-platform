import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

export async function GET(req: Request) {
  try {
    const qs = new URL(req.url).search;
    const data = await serverApi().get(`/payments/reports/detailed${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status });
  }
}

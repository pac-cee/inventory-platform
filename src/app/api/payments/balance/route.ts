import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

export async function GET() {
  try {
    const api = serverApi();
    const balance = await api.get<unknown>("/payments/balance");
    return NextResponse.json(balance);
  } catch (error) {
    console.error("GET /api/payments/balance failed:", error);
    const status = error instanceof ApiError ? error.status : 500;
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status });
  }
}

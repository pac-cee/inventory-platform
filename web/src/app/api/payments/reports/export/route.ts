import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/session";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function GET() {
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/payments/reports/export`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to generate report on the backend." },
        { status: res.status }
      );
    }

    const csvContent = await res.text();

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=corporate_expense_report.csv",
      },
    });
  } catch (error) {
    console.error("GET /api/payments/reports/export failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

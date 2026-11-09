import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status || !["approved", "rejected"].includes(status)) {
      return NextResponse.json(
        { error: "Valid transaction ID and status (approved/rejected) are required." },
        { status: 400 }
      );
    }

    const api = serverApi();

    // Send payload to Express API /payments/resolve
    const backendRes = await api.post<any>("/payments/resolve", {
      id,
      status
    });

    // Translate resolved transaction. `outcome` is what the backend actually
    // did: an approved BK transfer can still be "processing" (202) because the
    // provider confirms asynchronously, so the UI must not assume "completed".
    const mappedTx = {
      id,
      status: status === "approved" ? ("approved" as const) : ("rejected" as const),
      outcome: (backendRes?.status as "completed" | "processing" | "rejected" | "failed" | undefined) ?? undefined,
    };

    return NextResponse.json({ ok: true, transaction: mappedTx });
  } catch (error) {
    console.error("POST /api/payments/resolve failed:", error);
    const status = error instanceof ApiError ? error.status : 500;
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/session";
import { ApiError } from "@/lib/api/server";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = await getAccessToken();
    
    // Parse incoming multipart/form-data
    const formData = await request.formData();
    
    // Proxy the exact same FormData to the Express backend
    const res = await fetch(`${API_URL}/payments/transactions/${id}/receipt`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, data?.error?.message || "Failed to upload receipt to backend");
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`PATCH /api/payments/transactions/${await params.then(p => p.id)}/receipt failed:`, error);
    const status = error instanceof ApiError ? error.status : 500;
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status });
  }
}

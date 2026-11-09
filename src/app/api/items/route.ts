import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const api = serverApi();
    const item = await api.post("/items", {
      type: body.type,
      name: body.name,
      model: body.model,
      // No `sku` — the API assigns it from the type.
      specification: body.specification || null,
      category: body.category || null,
      finishable: typeof body.finishable === "boolean" ? body.finishable : undefined,
      units_per_container: body.units_per_container || undefined,
      package_label: body.package_label || null,
    });
    return NextResponse.json(item);
  } catch (error) {
    console.error("POST /api/items failed:", error);
    const status = error instanceof ApiError ? error.status : 500;
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status });
  }
}

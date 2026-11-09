import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

export async function GET() {
    try {
        const api = serverApi()
        const budget = await api.get<any>("/payments/budgets");
        return NextResponse.json(budget);

    } catch (error) {
        console.log("GET /api/payments/budgets failed:", error)
        const status = error instanceof ApiError ? error.status : 500
        return NextResponse.json({ error: "Could not fetch budget" }, { status })
    }
}

export async function POST(request: Request) {
    try {
        const api = serverApi()
        const body = await request.json()
        const budget = await api.post<any>("/payments/budgets", body);
        return NextResponse.json(budget);
    } catch (error) {
        console.log("POST /api/payments/budgets failed:", error)
        const status = error instanceof ApiError ? error.status : 500
        return NextResponse.json({ error: "Could not create budget" }, { status })
    }
}

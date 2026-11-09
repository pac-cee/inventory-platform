import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";

interface BackendProduct {
  name: string;
  description?: string | null;
  sku?: string | null;
  type?: string | null;
  model?: string | null;
  specification?: string | null;
  quantity: number;
  price: number;
  item_photo_base64?: string | null;
}

interface BackendTransaction {
  id: string;
  user_id: string;
  recipient_phone: string;
  recipient_name?: string | null;
  amount: number;
  status: string;
  momo_ref?: string | null;
  item_photo_base64?: string | null;
  receipt_base64?: string | null;
  location_id: string;
  created_at: string;
  payment_method?: string;
  payment_metadata?: any;
  profiles?: {
    full_name?: string | null;
  } | null;
  locations?: {
    name?: string | null;
  } | null;
  transaction_products?: BackendProduct[] | null;
}

interface RequestBody {
  recipient?: string;
  recipientName?: string;
  locationId?: string;
  locationName?: string;
  createdBy?: string;
  imageName?: string | null;
  products?: (BackendProduct & { image?: string | null })[];
  paymentMethod?: "momo" | "bk";
  payment_metadata?: any;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    const api = serverApi();
    const url = userId 
      ? `/payments/transactions?limit=100&userId=${userId}` 
      : "/payments/transactions?limit=100";

    const backendTxs = await api.get<BackendTransaction[]>(url);

    const mappedTxs = backendTxs.map((tx) => {
      const products = (tx.transaction_products || []).map((p) => ({
        name: p.name,
        description: p.description || "",
        sku: p.sku || "",
        type: p.type || "",
        model: p.model || "",
        specification: p.specification || "",
        quantity: p.quantity,
        price: p.price,
        image: p.item_photo_base64 || undefined
      }));

      return {
        id: tx.id,
        recipient: tx.recipient_phone,
        recipientName: tx.recipient_name || undefined,
        products: products,
        productName: products.map((p) => p.name).join(", ") || "N/A",
        description: products[0]?.description || "",
        quantity: products.reduce((sum, p) => sum + (p.quantity || 0), 0),
        price: tx.amount, // Total amount is directly stored in the transaction
        status: tx.status,
        imageName: tx.item_photo_base64 || undefined,
        itemPhoto: tx.item_photo_base64 || undefined,
        receiptPhoto: tx.receipt_base64 || undefined,
        receiptImage: tx.receipt_base64 || undefined,
        isStocked: (tx as any).is_stocked || false,
        createdBy: tx.profiles?.full_name || "Unknown",
        createdAt: tx.created_at,
        locationId: tx.location_id,
        locationName: tx.locations?.name || "",
        paymentMethod: tx.payment_method,
        paymentMetadata: tx.payment_metadata,
      };
    });

    return NextResponse.json(mappedTxs);
  } catch (error) {
    console.error("GET /api/payments failed:", error);
    const status = error instanceof ApiError ? error.status : 500;
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    // BK covers two patterns (see src/lib/urubutopay/transfer.ts on the
    // backend): a phone number (employee reimbursement) or bank account
    // details (vendor payment) — exactly one is required.
    const hasBkBankAccount = !!(
      body.payment_metadata?.bankAccountNumber &&
      body.payment_metadata?.bankAccountName &&
      body.payment_metadata?.tinNumber
    );
    if (
      (body.paymentMethod !== "bk" && !body.recipient) ||
      (body.paymentMethod === "bk" && !body.recipient && !hasBkBankAccount) ||
      !body.locationId ||
      !body.createdBy ||
      !Array.isArray(body.products) ||
      body.products.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Destination details, storage location, createdBy, and a non-empty products list are required.",
        },
        { status: 400 }
      );
    }

    const api = serverApi();

    const backendRes = await api.post<{ transactionId: string; status: string }>("/payments/request", {
      recipient_phone: body.recipient ? String(body.recipient).trim() : undefined,
      recipient_name: body.recipientName ? String(body.recipientName).trim().slice(0, 100) : undefined,
      location_id: String(body.locationId).trim(),
      payment_method: body.paymentMethod || "momo",
      payment_metadata: hasBkBankAccount ? body.payment_metadata : undefined,
      products: body.products.map((p) => ({
        name: String(p.name).trim(),
        description: p.description ? String(p.description).trim() : null,
        type: p.type ? String(p.type).trim() : null,
        model: p.model ? String(p.model).trim() : null,
        specification: p.specification ? String(p.specification).trim() : null,
        quantity: parseInt(String(p.quantity)) || 1,
        price: parseFloat(String(p.price)) || 0,
        image_base64: p.image || null
      })),
      receipt_base64: null
    });

    const totalQty = body.products.reduce((sum, p) => sum + (parseInt(String(p.quantity)) || 1), 0);
    const totalAmount = body.products.reduce((sum, p) => sum + ((parseFloat(String(p.price)) || 0) * (parseInt(String(p.quantity)) || 1)), 0);

    const mappedTx = {
      id: backendRes.transactionId,
      recipient: body.recipient ? String(body.recipient).trim() : "",
      products: body.products,
      productName: body.products.map((p) => p.name).join(", "),
      description: body.products[0]?.description || "",
      quantity: totalQty,
      price: totalAmount,
      status: backendRes.status,
      createdBy: String(body.createdBy).trim(),
      createdAt: new Date().toISOString(),
      locationId: String(body.locationId).trim(),
      locationName: String(body.locationName || "").trim(),
      paymentMethod: body.paymentMethod || "momo",
      paymentMetadata: body.payment_metadata,
    };

    return NextResponse.json({ ok: true, transaction: mappedTx });
  } catch (error: any) {
    console.error("POST /api/payments failed:", error, error.details || "");
    const status = error instanceof ApiError ? error.status : 500;
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg, details: error.details }, { status });
  }
}

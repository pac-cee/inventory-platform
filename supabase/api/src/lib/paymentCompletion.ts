// Shared BK/UrubutoPay transaction completion logic (PENDING leaves everything untouched) — used by both the
// synchronous status check inside POST /payments/resolve and the async
// BULK_DISBURSEMENT_PAYMENT webhook, so a transfer that resolves after the
// synchronous check gets exactly the same completion behavior either way.
import { exec, maybeOne, one } from "../db.js"
import { withAllocatedSku } from "./skuAllocator.js"

interface FinalizableTx {
  id: string
  amount: number
  location_id: string
  user_id: string
  transaction_products?: Array<{
    name: string
    type?: string | null
    model?: string | null
    sku?: string | null
    specification?: string | null
    description?: string | null
    quantity: number
  }>
}

export async function finalizeBkTransaction(
  tx: FinalizableTx,
  budgetId: string,
  result: { status: "SUCCESSFUL" | "FAILED" | "PENDING"; reason?: any },
  // Used when the provider gives no failure code (BK by default; MoMo passes its own).
  defaultFailureReason = "BK_PAYMENT_FAILED",
): Promise<"completed" | "failed" | "processing" | "skipped"> {
  // Still in flight: UrubutoPay debits first and pays the beneficiary after, so
  // PENDING/INITIATED is the normal state right after initiate. Leave the
  // transaction 'processing' and the budget reserved — the webhook or the
  // reconciler settles it. Refunding here would hand back budget for money that
  // is about to leave the wallet.
  if (result.status === "PENDING") return "processing"

  if (result.status === "SUCCESSFUL") {
    // Atomic claim: webhook retries, the reconciler and the sync check can all
    // arrive together; only the one that moves the row gets to seed stock.
    const claimed = await maybeOne<{ id: string }>(
      "update corporate_transactions set status = 'completed' where id = $1 and status in ('pending','processing') returning id",
      [tx.id],
    )
    if (!claimed) return "skipped"

    // Seed stock for every purchased product (only on payment success).
    const products = tx.transaction_products || []
    for (const product of products) {
      let itemId: string
      // Same identity rule as the catalog (type, name, model), so a repeat
      // purchase tops up the existing item rather than creating a twin.
      const itemType = product.type || product.name
      const itemModel = product.model || "Unspecified"
      const existingItem = await maybeOne<{ id: string }>(
        "select id from items where lower(type) = lower($1) and lower(name) = lower($2) and lower(model) = lower($3)",
        [itemType, product.name, itemModel],
      )
      if (existingItem) {
        itemId = existingItem.id
      } else {
        const newItem = await withAllocatedSku(itemType, (sku) =>
          one<{ id: string }>(
            "insert into items (sku, type, name, model, specification) values ($1, $2, $3, $4, $5) returning id",
            [sku, itemType, product.name, itemModel, product.specification || product.description || null],
          ),
        )
        itemId = newItem.id
      }

      await exec(
        `insert into stock_movements (item_id, location_id, user_id, delta, capacity_delta, reason, note)
           values ($1, $2, $3, $4, $5, 'initial', $6)`,
        [itemId, tx.location_id, tx.user_id, product.quantity, product.quantity, `Auto-purchased via corporate transaction ${tx.id}`],
      )
      console.log(`[Payments] Stock updated successfully for Item: ${product.name}.`)
    }

    await exec("update corporate_transactions set is_stocked = true where id = $1", [tx.id])
    return "completed"
  }

  // FAILED: confirmed by UrubutoPay, so the reserved budget goes back.
  const failureReason =
    (result.reason && typeof result.reason === "object" ? result.reason.code : result.reason) || defaultFailureReason
  const claimed = await maybeOne<{ id: string }>(
    "update corporate_transactions set status = 'failed', failure_reason = $2 where id = $1 and status in ('pending','processing') returning id",
    [tx.id, failureReason],
  )
  if (!claimed) return "skipped"
  await exec("update monthly_budgets set remaining_amount = remaining_amount + $2 where id = $1", [budgetId, Number(tx.amount)])

  return "failed"
}

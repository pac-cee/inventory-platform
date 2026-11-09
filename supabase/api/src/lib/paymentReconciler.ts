// Settles BK/UrubutoPay and MTN MoMo transfers that were dispatched but never
// reached a terminal state (the webhook was missed, or the sync status check
// saw PENDING, or the provider's answer was lost). Safe to run repeatedly:
// finalizeBkTransaction claims each row atomically, so a webhook racing this
// job cannot double-apply stock/budget.
import { rows } from "../db.js"
import { bk } from "./bk.js"
import { momo } from "./momo.js"
import { finalizeBkTransaction } from "./paymentCompletion.js"

export interface ReconcileSummary {
  checked: number
  completed: number
  failed: number
  stillProcessing: number
  errors: number
  // Dispatched with no reference stored (unknown outcome) — need a human to
  // look at the UrubutoPay portal; the job cannot look them up.
  needsManualReview: string[]
}

export async function reconcileBkTransactions(minAgeSeconds = 60): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, completed: 0, failed: 0, stillProcessing: 0, errors: 0, needsManualReview: [] }

  const stuck = await rows<any>(
    `select t.*,
            (select coalesce(json_agg(tp order by tp.id), '[]'::json)
               from transaction_products tp where tp.transaction_id = t.id) as transaction_products
       from corporate_transactions t
      where t.payment_method in ('bk', 'momo') and t.status = 'processing'
        and t.created_at < now() - ($1 * interval '1 second')
      order by t.created_at
      limit 100`,
    [minAgeSeconds],
  )

  for (const tx of stuck) {
    if (!tx.momo_ref) {
      summary.needsManualReview.push(tx.id)
      continue
    }
    if (!tx.budget_id) {
      console.error(`[Reconcile] Tx ${tx.id} has no budget_id — cannot finalize, needs manual review`)
      summary.needsManualReview.push(tx.id)
      continue
    }
    summary.checked++
    try {
      const isMomo = tx.payment_method === "momo"
      const status = isMomo ? await momo.getTransferStatus(tx.momo_ref) : await bk.getTransferStatus(tx.momo_ref)

      // MTN has no record of the reference. That happens after a timeout, and it
      // does NOT prove nothing was paid (the record may simply not be visible
      // yet, or the request may still be in flight). There is no "sent at"
      // timestamp to measure a safe waiting period from, so never refund on this:
      // leave it for a person to check in the MTN portal.
      if (isMomo && (status as any).notFound) {
        summary.stillProcessing++
        summary.needsManualReview.push(tx.id)
        console.error(`[Reconcile] Tx ${tx.id}: MTN has no record of reference ${tx.momo_ref} — left processing for manual review (not refunded)`)
        continue
      }

      const outcome = await finalizeBkTransaction(tx, tx.budget_id, status, isMomo ? "MOMO_PAYMENT_FAILED" : "BK_PAYMENT_FAILED")
      if (outcome === "completed") summary.completed++
      else if (outcome === "failed") summary.failed++
      else summary.stillProcessing++
      console.log(`[Reconcile] Tx ${tx.id}: provider says ${status.status} -> ${outcome}`)
    } catch (err: any) {
      summary.errors++
      console.error(`[Reconcile] Tx ${tx.id}: status lookup failed:`, err?.message)
    }
  }

  if (summary.needsManualReview.length) {
    console.error(`[Reconcile] ${summary.needsManualReview.length} transaction(s) need manual review: ${summary.needsManualReview.join(", ")}`)
  }
  return summary
}

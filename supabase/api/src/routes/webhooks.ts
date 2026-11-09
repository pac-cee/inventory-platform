import { Router } from "express"
import { asyncHandler } from "../http.js"
import { maybeOne } from "../db.js"
import { mapUrubutoStatus } from "../lib/urubutopay/statusMap.js"
import { finalizeBkTransaction } from "../lib/paymentCompletion.js"
import { bk } from "../lib/bk.js"
import { momo } from "../lib/momo.js"
import { credentialsMatch, issueWebhookToken, requireWebhookAuth, now } from "../lib/urubutopay/webhookAuth.js"

export const webhooksRouter = Router()

const TX_WITH_PRODUCTS =
  `(select coalesce(json_agg(tp order by tp.id), '[]'::json)
      from transaction_products tp where tp.transaction_id = t.id) as transaction_products`

// UrubutoPay POSTs here when a bulk-disbursement transfer's status changes
// (BulkDisbursement PDF §3.4: BULK_DISBURSEMENT_DEBIT / BULK_DISBURSEMENT_PAYMENT).
//
// Authenticated with the Bearer token UrubutoPay obtains from
// POST /webhooks/urubutopay/auth (see lib/urubutopay/webhookAuth.ts). Even so,
// the callback body is never trusted for money decisions: before finalizing we
// ask UrubutoPay directly (check-transfer) and act on THAT answer. We never
// override a transaction that's already terminal (`completed`/`failed`) — only
// flag a disagreement for manual reconciliation. Mounted outside
// paymentsRouter's requireAuth/requirePaymentAccess, since UrubutoPay's
// servers have no session JWT.
const ok = () => ({ timestamp: now(), status: 200, message: "Callback received successfully" })

// UrubutoPay logs in here to get the Bearer token it will put on callbacks.
webhooksRouter.post("/urubutopay/auth", asyncHandler(async (req, res) => {
  const { user_name, password } = req.body || {}
  if (!credentialsMatch(user_name, password)) {
    console.warn(`[UrubutoPay Webhook] auth rejected from ${req.ip}`)
    return res.status(401).json({ timestamp: now(), status: 401, message: "Invalid credentials" })
  }
  res.json({ timestamp: now(), message: "Successful", status: 200, data: { token: await issueWebhookToken() } })
}))

webhooksRouter.post("/urubutopay", requireWebhookAuth, asyncHandler(async (req, res) => {
  const body = req.body || {}
  console.log("[UrubutoPay Webhook] Received:", JSON.stringify(body))

  if (body.callback_type !== "BULK_DISBURSEMENT_PAYMENT") {
    // BULK_DISBURSEMENT_DEBIT is a bulk-level event — no single-transaction
    // meaning for our always-one-beneficiary-per-request usage.
    return res.json(ok())
  }

  const internalRef = body.internal_transaction_ref_number
  const beneficiaryCode = body.beneficiary_code
  if (!internalRef || !beneficiaryCode) {
    console.warn("[UrubutoPay Webhook] Missing internal_transaction_ref_number or beneficiary_code — ignoring")
    return res.json(ok())
  }

  // Matches the composite ref src/lib/urubutopay/transfer.ts stores as momo_ref.
  const momoRef = `${internalRef}:${beneficiaryCode}`
  const tx = await maybeOne<any>(
    `select t.*, ${TX_WITH_PRODUCTS} from corporate_transactions t where t.momo_ref = $1`,
    [momoRef],
  )
  if (!tx) {
    console.warn(`[UrubutoPay Webhook] No transaction found for ref ${momoRef}`)
    return res.json(ok())
  }

  const mappedStatus = mapUrubutoStatus(body.transaction_status)

  if (tx.status === "pending" || tx.status === "processing") {
    if (mappedStatus === "PENDING") {
      console.log(`[UrubutoPay Webhook] Tx ${tx.id} still PENDING per webhook — no action taken`)
      return res.json(ok())
    }
    if (!tx.budget_id) {
      console.error(`[UrubutoPay Webhook] Tx ${tx.id} has no budget_id — cannot finalize, needs manual review`)
      return res.json(ok())
    }

    // Don't take the callback's word for it: ask UrubutoPay. In mock mode there
    // is no provider to ask, so the callback status stands (dev/tests only).
    let verified: { status: "SUCCESSFUL" | "FAILED" | "PENDING"; reason?: any } = {
      status: mappedStatus,
      reason: body.transaction_status,
    }
    if (!bk.isMock) {
      try {
        verified = await bk.getTransferStatus(momoRef)
      } catch (err: any) {
        // 500 makes UrubutoPay retry (30s, 2m, 10m, 30m); the reconciler also
        // covers it. Nothing has been changed.
        console.error(`[UrubutoPay Webhook] Tx ${tx.id}: could not verify with check-transfer (${err?.message}) — asking for a retry`)
        return res.status(500).json({ timestamp: now(), status: 500, message: "server error" })
      }
      if (verified.status !== mappedStatus) {
        console.warn(`[UrubutoPay Webhook] Tx ${tx.id}: callback said ${mappedStatus} but check-transfer says ${verified.status} — trusting check-transfer`)
      }
    }
    if (verified.status === "PENDING") {
      console.log(`[UrubutoPay Webhook] Tx ${tx.id} not confirmed by check-transfer yet — no action taken`)
      return res.json(ok())
    }
    const outcome = await finalizeBkTransaction(tx, tx.budget_id, {
      status: verified.status,
      reason: verified.reason ?? body.transaction_status,
    })
    console.log(`[UrubutoPay Webhook] Tx ${tx.id} -> ${outcome} (provider: ${verified.status})`)
    return res.json(ok())
  }

  // Already terminal — never re-apply budget/stock side effects a second
  // time. Only flag if the outcome disagrees with what we already recorded,
  // so a human reconciles it rather than the app silently guessing.
  const alreadyReflectsSuccess = tx.status === "completed"
  const webhookSaysSuccess = mappedStatus === "SUCCESSFUL"
  if (alreadyReflectsSuccess !== webhookSaysSuccess) {
    console.error(
      `[UrubutoPay Webhook] MISMATCH — tx ${tx.id} is already '${tx.status}' but UrubutoPay now reports ` +
      `'${body.transaction_status}' (mapped: ${mappedStatus}) — needs manual reconciliation.`,
    )
  }
  return res.json(ok())
}))

// ── MTN MoMo ───────────────────────────────────────────────────────────────
// MTN calls the address we gave it in X-Callback-Url when a transfer settles:
// /webhooks/mtn/<payment id>. Per MTN's callback page it is a PUT (diagram) or POST
// (text), carries no signature, and is sent ONCE with no retry — so both methods are
// accepted, and the reconciler (every 2 minutes) remains the safety net.
//
// Nothing in the body is trusted, or even read: the only thing used is the payment
// id in the path, as a prompt to ask MTN for the real status and act on THAT. A
// forged or garbled callback can therefore only trigger a harmless status lookup.
// Always answers 200: MTN does not retry, so a failure code would help nobody, and a
// uniform answer leaks nothing about which payments exist.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const mtnOk = (res: any) => res.status(200).json({ ok: true })

async function handleMtnCallback(req: any, res: any) {
  const ref = String(req.params.ref ?? "")
  const peek = JSON.stringify(req.body ?? {}).slice(0, 300) // for the log only; never acted on
  console.log(`[MTN Callback] ${req.method} ref=${ref} body≈${peek}`)
  if (!UUID.test(ref)) return mtnOk(res)

  const tx = await maybeOne<any>(
    `select t.*, ${TX_WITH_PRODUCTS} from corporate_transactions t where t.momo_ref = $1 and t.payment_method = 'momo'`,
    [ref.toLowerCase()],
  )
  if (!tx) {
    console.warn(`[MTN Callback] no MoMo payment for ref ${ref}`)
    return mtnOk(res)
  }
  if (tx.status !== "pending" && tx.status !== "processing") return mtnOk(res) // already settled: nothing to apply twice
  if (!tx.budget_id) {
    console.error(`[MTN Callback] Tx ${tx.id} has no budget_id — cannot finalize, needs manual review`)
    return mtnOk(res)
  }

  let status
  try {
    status = await momo.getTransferStatus(ref)
  } catch (err: any) {
    console.error(`[MTN Callback] Tx ${tx.id}: could not verify with MTN (${err?.message}) — left to the reconciler`)
    return mtnOk(res)
  }
  if ((status as any).notFound || status.status === "PENDING") {
    console.log(`[MTN Callback] Tx ${tx.id}: MTN says ${status.status}${(status as any).notFound ? " (no record)" : ""} — no action`)
    return mtnOk(res)
  }
  const outcome = await finalizeBkTransaction(tx, tx.budget_id, status, "MOMO_PAYMENT_FAILED")
  console.log(`[MTN Callback] Tx ${tx.id} -> ${outcome} (MTN: ${status.status})`)
  return mtnOk(res)
}

webhooksRouter.put("/mtn/:ref", asyncHandler(handleMtnCallback))
webhooksRouter.post("/mtn/:ref", asyncHandler(handleMtnCallback))

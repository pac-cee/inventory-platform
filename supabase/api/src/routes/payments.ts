import { NextFunction, Router, type Request, type Response } from "express"
import { z } from "zod"
import { asyncHandler, HttpError } from "../http.js"
import { requireAuth, requireAdmin } from "../middleware/auth.js"
import { verifyLimits } from "../middleware/limits.js"
import { momo } from "../lib/momo.js"
import { bk } from "../lib/bk.js"
import { finalizeBkTransaction } from "../lib/paymentCompletion.js"
import { reconcileBkTransactions } from "../lib/paymentReconciler.js"
import { describeMoMoReason } from "../lib/momoErrors.js"
import { checkDriveSetup } from "../lib/drive.js"
import { withAllocatedSku } from "../lib/skuAllocator.js"
import { requirePaymentAccess, requireAdminOrCashier } from "../middleware/auth.js";
import { rows, maybeOne, one, exec, updateById } from "../db.js"
import multer from "multer"
import { uploadEbmReceipt } from "../lib/drive.js"

const upload = multer({ storage: multer.memoryStorage() })

export const paymentsRouter = Router()

paymentsRouter.use(requireAuth);
paymentsRouter.use(requirePaymentAccess);

// A transaction with its products embedded as `transaction_products`, matching
// the old PostgREST embed. Children default to [] when none.
const TX_PRODUCTS =
  `(select coalesce(json_agg(tp order by tp.id), '[]'::json)
      from transaction_products tp where tp.transaction_id = t.id) as transaction_products`

const paymentSettingsBody = z.object({
  has_payment_permission: z.boolean().optional(),
  fallback_role: z.enum(["cashier", "none"]).optional(),
  daily_limit: z.coerce.number().nonnegative().optional(),
  monthly_limit: z.coerce.number().nonnegative().optional(),
  per_transaction_limit: z.coerce.number().nonnegative().optional(),
})

paymentsRouter.patch("/profiles/:id/payment-settings", requireAdmin, asyncHandler(async (req, res) => {
  const body = paymentSettingsBody.parse(req.body);
  res.json(await updateById("profiles", req.params.id, body))
}))

function calculateTotalAmount(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && Array.isArray(req.body.products)) {
    const total = req.body.products.reduce((sum: number, p: any) => {
      const price = Number(p.price) || 0;
      const qty = Number(p.quantity) || 0;
      return sum + (price * qty);
    }, 0);
    req.body.amount = total;
  }
  next();
}

const paymentRequestSchema = z.object({
  recipient_phone: z.string().trim().optional(),
  // Who a BK mobile-money payment is for. Optional so older app builds still work.
  recipient_name: z.string().trim().max(100).optional(),
  amount: z.coerce.number().positive(),
  location_id: z.string().uuid(),
  products: z.array(
    z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().nullable().optional(),
      // Carried through so an approved purchase creates a properly shaped
      // catalog item. Optional: an older client build sends neither, and the
      // completion path falls back to the product name / 'Unspecified'.
      type: z.string().trim().min(1).nullable().optional(),
      model: z.string().trim().min(1).nullable().optional(),
      // Kept for history. No longer seeds the item's SKU — that is assigned by
      // the machine from the item type (see lib/sku.ts).
      sku: z.string().trim().nullable().optional(),
      specification: z.string().trim().nullable().optional(),
      quantity: z.coerce.number().int().positive(),
      price: z.coerce.number().nonnegative(),
      image_base64: z.string().trim().nullable().optional()
    })
  ).nonempty(),
  receipt_base64: z.string().trim().nullable().optional(),
  payment_method: z.enum(["momo", "bk"]).default("momo"),
  payment_metadata: z.object({
    bankAccountNumber: z.string().trim(),
    bankAccountName: z.string().trim(),
    tinNumber: z.string().trim()
  }).optional()
}).refine(data => {
  if (data.payment_method === "momo" && !data.recipient_phone) return false;
  // BK covers two patterns (see src/lib/urubutopay/transfer.ts): a phone
  // number (employee reimbursement, via mobile money) or bank account
  // details (vendor payment, via EKASH) — exactly one is required.
  if (data.payment_method === "bk" && !data.recipient_phone && !data.payment_metadata) return false;
  return true;
}, { message: "Invalid payment details provided for the selected method." })

paymentsRouter.post("/request", calculateTotalAmount, verifyLimits, asyncHandler(async (req, res) => {
  const body = paymentRequestSchema.parse(req.body)

  // Atomic parent + children insert via the ported Postgres function.
  let row: { id: string }
  try {
    row = await one<{ id: string }>(
      "select create_corporate_transaction($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) as id",
      [
        req.user.id,
        body.recipient_phone || null,
        body.amount,
        body.location_id,
        body.receipt_base64 || null,
        JSON.stringify(body.products),
        body.payment_metadata ? JSON.stringify(body.payment_metadata) : null
      ],
    )
  } catch (err: any) {
    // A location can be hard-deleted (locations.ts) once it has zero
    // stock/history — if a client had it cached in an open request form,
    // this insert fails here with a foreign-key violation on location_id.
    // Give a specific, actionable message instead of the generic backstop
    // in http.ts's fromPgError (which is written for delete-blocked cases,
    // not a missing-parent insert).
    if (err?.code === "23503" && err?.constraint === "corporate_transactions_location_id_fkey") {
      throw new HttpError(409, "That location no longer exists — refresh and pick another.", "location_not_found")
    }
    throw err
  }

  // The name only matters for a BK payment to a phone; store nothing otherwise.
  const recipientName = body.payment_method === "bk" && body.recipient_phone ? body.recipient_name || null : null
  await exec("update corporate_transactions set payment_method = $2, recipient_name = $3 where id = $1", [
    row.id,
    body.payment_method,
    recipientName,
  ])

  return res.json({ transactionId: row.id, status: "pending" })
}))

const resolvePaymentSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "rejected"])
})

paymentsRouter.post("/resolve", requireAdminOrCashier, asyncHandler(async (req, res) => {
  const { id, status } = resolvePaymentSchema.parse(req.body)

  // 1. Atomically claim the transaction: only one concurrent /resolve call
  // can move it out of 'pending', so double-clicks/duplicate requests can't
  // both pass the guard and double-disburse.
  //
  // The `user_id <> $2` term is separation of duties: nobody resolves their own
  // request, not even an admin. It lives in the UPDATE rather than in a check
  // beforehand so the claim stays a single atomic statement — a separate read
  // would leave a window where the row is claimed and then has to be un-claimed.
  const tx = await maybeOne<any>(
    `update corporate_transactions t
        set status = 'processing'
      where t.id = $1 and t.status = 'pending' and t.user_id <> $2
      returning t.*, ${TX_PRODUCTS}`,
    [id, req.profile?.id ?? null],
  )
  if (!tx) {
    const existing = await maybeOne<{ id: string; user_id: string; status: string }>(
      "select id, user_id, status from corporate_transactions where id = $1",
      [id],
    )
    if (!existing) throw new HttpError(404, "Transaction not found", "not_found")
    if (existing.user_id === req.profile?.id) {
      throw new HttpError(
        403,
        "You cannot resolve your own payment request. Someone else has to approve or reject it.",
        "self_approval",
      )
    }
    throw new HttpError(409, "Transaction has already been resolved or is being processed", "already_resolved")
  }

  if (status === "rejected") {
    await exec("update corporate_transactions set status = 'failed', failure_reason = $2 where id = $1", [id, "Rejected by Administrator"])
    return res.json({ transactionId: id, status: "rejected" })
  }

  // 2. Approval — verify the monthly budget for the tx's month.
  const txDate = new Date(tx.created_at)
  const year = txDate.getFullYear()
  const month = txDate.getMonth() + 1

  const budget = await maybeOne<any>(
    "select * from monthly_budgets where year = $1 and month = $2",
    [year, month],
  )
  if (!budget || Number(budget.remaining_amount) < Number(tx.amount)) {
    const reason = !budget ? "NO_BUDGET_ALLOCATED" : "INSUFFICIENT_MONTHLY_BUDGET"
    await exec("update corporate_transactions set status = 'failed', failure_reason = $2 where id = $1", [id, reason])
    throw new HttpError(400, !budget ? "No budget allocated for this month." : "Insufficient monthly budget balance", "insufficient_budget")
  }

  // Reserve funds immediately, and link the budget to the transaction.
  const reservedRemaining = Number(budget.remaining_amount) - Number(tx.amount)
  await exec("update monthly_budgets set remaining_amount = $2 where id = $1", [budget.id, reservedRemaining])
  await exec("update corporate_transactions set budget_id = $2 where id = $1", [tx.id, budget.id])

  if (tx.payment_method === "bk") {
    // Step 1 — dispatch. A definite rejection refunds; an unknown outcome
    // (timeout / 5xx / network) must NOT, because the money may have moved.
    let bkRef: string
    try {
      console.log(`[Payments] Dispatching BK/UrubutoPay transfer for Tx: ${tx.id}...`)
      bkRef = await bk.transfer({ phone: tx.recipient_phone, recipientName: tx.recipient_name, metadata: tx.payment_metadata }, tx.amount, tx.id)
    } catch (bkErr: any) {
      if (bkErr?.unknownOutcome) {
        console.error(`[Payments] BK outcome UNKNOWN for Tx ${tx.id} — holding as processing, budget stays reserved:`, bkErr.message)
        await exec("update corporate_transactions set failure_reason = $2 where id = $1", [tx.id, `UNCONFIRMED: ${bkErr.message}`])
        return res.status(202).json({
          transactionId: tx.id,
          status: "processing",
          code: "bk_outcome_unknown",
          reason: "The payment provider did not confirm whether the transfer was made. It is on hold for reconciliation — do not retry.",
        })
      }
      console.error("[Payments] BK dispatch rejected:", bkErr)
      await exec("update monthly_budgets set remaining_amount = remaining_amount + $2 where id = $1", [budget.id, Number(tx.amount)])
      const failureReason = bkErr.message || "BK_DISPATCH_ERROR"
      await exec("update corporate_transactions set status = 'failed', failure_reason = $2 where id = $1", [tx.id, failureReason])
      return res.status(502).json({ error: "BK disbursement failed", code: "bk_dispatch_error", reason: failureReason })
    }

    await exec("update corporate_transactions set status = 'processing', momo_ref = $2, failure_reason = null where id = $1", [tx.id, bkRef])

    // Step 2 — one status look. The transfer exists now, so nothing below may
    // refund on an error: a failed lookup just leaves it for the reconciler.
    let statusRef: { status: "SUCCESSFUL" | "FAILED" | "PENDING"; reason?: any }
    try {
      console.log(`[Payments] Checking BK status for Ref: ${bkRef}...`)
      statusRef = await bk.getTransferStatus(bkRef)
    } catch (statusErr: any) {
      console.error(`[Payments] BK status check failed for Tx ${tx.id} (transfer was dispatched; left processing):`, statusErr?.message)
      statusRef = { status: "PENDING" }
    }

    const outcome = await finalizeBkTransaction(tx, budget.id, statusRef)
    if (outcome === "completed") return res.json({ transactionId: tx.id, status: "completed" })
    if (outcome === "failed") {
      const failureReason = (statusRef.reason && typeof statusRef.reason === "object" ? statusRef.reason.code : statusRef.reason) || "BK_PAYMENT_FAILED"
      return res.status(400).json({ error: "BK payment was unsuccessful", code: "bk_payment_failed", reason: failureReason })
    }
    if (outcome === "skipped") {
      // A webhook settled it between our two steps — report whatever it became.
      const now = await maybeOne<{ status: string }>("select status from corporate_transactions where id = $1", [tx.id])
      return res.json({ transactionId: tx.id, status: now?.status ?? "processing" })
    }
    return res.status(202).json({ transactionId: tx.id, status: "processing" })
  }

  // 3. Dispatch MoMo disbursement — the same rules as the BK branch above:
  //    - the payment's own id is the MTN reference (X-Reference-Id), so a retry can
  //      never pay twice;
  //    - a definite refusal refunds; an unknown outcome (timeout / 5xx) does NOT,
  //      because the money may have moved;
  //    - "pending" is the normal state right after MTN accepts a transfer, so it
  //      stays processing with the budget reserved; only a confirmed FAILED refunds.
  // The reference is stored BEFORE sending, so if MTN's answer is lost the
  // reconciler can still look the payment up by it.
  await exec("update corporate_transactions set momo_ref = $2 where id = $1", [tx.id, tx.id])

  let momoRef: string
  try {
    console.log(`[Payments] Dispatching MoMo disbursement for Tx: ${tx.id}...`)
    momoRef = await momo.transfer(tx.recipient_phone, tx.amount, tx.id)
  } catch (momoErr: any) {
    if (momoErr?.unknownOutcome) {
      console.error(`[Payments] MoMo outcome UNKNOWN for Tx ${tx.id} — holding as processing, budget stays reserved:`, momoErr.message)
      await exec("update corporate_transactions set failure_reason = $2 where id = $1", [tx.id, `UNCONFIRMED: ${momoErr.message}`])
      return res.status(202).json({
        transactionId: tx.id,
        status: "processing",
        code: "momo_outcome_unknown",
        reason: "MTN did not confirm whether the transfer was made. It is on hold for reconciliation — do not retry.",
      })
    }
    console.error("[Payments] MoMo dispatch rejected:", momoErr)
    await exec("update monthly_budgets set remaining_amount = remaining_amount + $2 where id = $1", [budget.id, Number(tx.amount)])
    const failureReason = momoErr.message || "GATEWAY_DISPATCH_ERROR"
    // Nothing was created at MTN, so there is no reference to keep.
    await exec("update corporate_transactions set status = 'failed', failure_reason = $2, momo_ref = null where id = $1", [tx.id, failureReason])
    return res.status(502).json({ error: "MoMo disbursement failed", code: "momo_dispatch_error", reason: failureReason })
  }

  await exec("update corporate_transactions set status = 'processing', momo_ref = $2, failure_reason = null where id = $1", [tx.id, momoRef])

  // One status look. The transfer exists now, so nothing below may refund on an
  // error: a failed lookup just leaves it for the reconciler.
  let statusRef: { status: "SUCCESSFUL" | "FAILED" | "PENDING"; reason?: any }
  try {
    console.log(`[Payments] Checking MoMo status for Ref: ${momoRef}...`)
    statusRef = await momo.getTransferStatus(momoRef)
  } catch (statusErr: any) {
    console.error(`[Payments] MoMo status check failed for Tx ${tx.id} (transfer was dispatched; left processing):`, statusErr?.message)
    statusRef = { status: "PENDING" }
  }

  const outcome = await finalizeBkTransaction(tx, budget.id, statusRef, "MOMO_PAYMENT_FAILED")
  if (outcome === "completed") return res.json({ transactionId: tx.id, status: "completed" })
  if (outcome === "failed") {
    const failureReason = (statusRef.reason && typeof statusRef.reason === "object" ? statusRef.reason.code : statusRef.reason) || "MOMO_PAYMENT_FAILED"
    return res.status(400).json({
      error: "MoMo payment was unsuccessful",
      code: "momo_payment_failed",
      reason: failureReason,
      // MTN's code in plain words, when we know what it means.
      reason_message: describeMoMoReason(String(failureReason)),
    })
  }
  if (outcome === "skipped") {
    // The reconciler settled it between our two steps — report whatever it became.
    const now = await maybeOne<{ status: string }>("select status from corporate_transactions where id = $1", [tx.id])
    return res.json({ transactionId: tx.id, status: now?.status ?? "processing" })
  }
  return res.status(202).json({ transactionId: tx.id, status: "processing" })
}))

// POST /reconcile (admin only) — settle BK and MoMo transfers stuck in 'processing'
// by asking the provider for their real status. The same job runs on a timer (see
// index.ts); this is the manual trigger.
paymentsRouter.post("/reconcile", requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await reconcileBkTransactions(0))
}))

// GET /balance (admin only). Defaults to the MoMo account; `?method=bk` returns
// the UrubutoPay merchant-wallet balance that BK payments are funded from.
paymentsRouter.get("/balance", requireAdmin, asyncHandler(async (req, res) => {
  const method = req.query.method === "bk" ? "bk" : "momo"
  try {
    const balance = method === "bk" ? await bk.getAccountBalance() : await momo.getAccountBalance()
    res.json(balance)
  } catch (err: any) {
    console.error(`[Payments] ${method} balance lookup failed:`, err?.message)
    const status = err.status === 404 ? 404 : 502
    throw new HttpError(
      status,
      // Admin-only route, so MTN's reason (in plain words) is shown rather than hidden.
      method === "bk"
        ? "Could not retrieve the UrubutoPay wallet balance."
        : `Could not retrieve MoMo account balance${err?.message ? `: ${err.message}` : "."}`,
      method === "bk" ? "bk_balance_error" : "momo_balance_error",
    )
  }
}))

// GET /egress-ip (admin only) — the public IP address this server shows to the outside
// world. MTN's Disbursement API (and UrubutoPay) only accept calls from IP addresses that
// have been allow-listed, so this is the number to give them. NOTE: on Railway the
// address is only stable if static outbound IPs are enabled for the service.
paymentsRouter.get("/egress-ip", requireAdmin, asyncHandler(async (_req, res) => {
  for (const url of ["https://api.ipify.org?format=json", "https://api64.ipify.org?format=json"]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (!r.ok) continue
      const j = (await r.json()) as { ip?: unknown }
      if (typeof j?.ip === "string" && j.ip) {
        return res.json({
          ip: j.ip,
          note: "This is the address other services see for this server. It only stays the same if the host has a static outbound IP.",
        })
      }
    } catch {
      /* try the next one */
    }
  }
  throw new HttpError(502, "Could not determine this server's public IP address.", "egress_ip_unavailable")
}))

// GET /drive-check (admin only) — tests the receipt storage step by step (credentials,
// Google's token, the folder) WITHOUT uploading anything, and says how to fix a failure.
// Never returns a secret: only whether each setting is present, and the folder name.
paymentsRouter.get("/drive-check", requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await checkDriveSetup())
}))

// PATCH /transactions/:id/receipt
paymentsRouter.patch("/transactions/:id/receipt", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, "No file provided", "bad_request")
  }

  // A Drive failure (bad folder id, revoked token) used to surface as a bare
  // "Internal server error". Say what actually failed so the phone can show it.
  let fileId: string
  try {
    fileId = await uploadEbmReceipt(req.file.buffer, req.file.originalname, req.file.mimetype)
  } catch (err: any) {
    console.error(`[Payments] Receipt upload to Drive failed for tx ${req.params.id}:`, err?.message)
    // A short non-secret code, so an admin can tell from the phone what is wrong
    // (then GET /payments/drive-check says how to fix it).
    const cause = err?.driveReason ? ` (cause: ${err.driveReason})` : ""
    throw new HttpError(
      502,
      `Couldn't store the receipt in Google Drive — the receipt storage isn't set up correctly. Ask an admin to check the Drive folder${cause}.`,
      "drive_upload_failed",
    )
  }

  res.json(await one(
    "update corporate_transactions set ebm_drive_file_id = $2 where id = $1 returning *",
    [req.params.id, fileId],
  ))
}))

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  userId: z.string().uuid().optional(),
})

paymentsRouter.get("/transactions", asyncHandler(async (req, res) => {
  const { limit, offset, userId } = listQuerySchema.parse(req.query)
  const isAdminOrCashier = req.profile?.role === "admin" || req.profile?.fallback_role === "cashier"

  if (!isAdminOrCashier && userId && userId !== req.user.id) {
    throw new HttpError(403, "You do not have permission to view another user's transactions.", "forbidden")
  }

  const params: unknown[] = []
  let scope = ""
  if (!isAdminOrCashier) {
    params.push(req.user.id)
    scope = `where t.user_id = $${params.length}`
  } else if (userId) {
    params.push(userId)
    scope = `where t.user_id = $${params.length}`
  }
  params.push(limit, offset)

  res.json(await rows(
    `select t.*,
            json_build_object('full_name', p.full_name, 'role', p.role, 'fallback_role', p.fallback_role) as profiles,
            case when l.id is null then null else json_build_object('name', l.name) end as locations,
            ${TX_PRODUCTS}
       from corporate_transactions t
       join profiles p on p.id = t.user_id
       left join locations l on l.id = t.location_id
       ${scope}
       order by t.created_at desc
       limit $${params.length - 1} offset $${params.length}`,
    params,
  ))
}))

const budgetSchema = z.object({
  allocated_amount: z.number().nonnegative()
})

paymentsRouter.get("/budgets", requireAdminOrCashier, asyncHandler(async (_req, res) => {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const budget = await maybeOne("select * from monthly_budgets where year = $1 and month = $2", [year, month])
  res.json(budget || { allocated_amount: 0, remaining_amount: 0, year, month })
}))

paymentsRouter.post("/budgets", requireAdminOrCashier, asyncHandler(async (req, res) => {
  const { allocated_amount } = budgetSchema.parse(req.body)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const existing = await maybeOne<any>("select * from monthly_budgets where year = $1 and month = $2", [year, month])

  let result
  if (existing) {
    const difference = allocated_amount - Number(existing.allocated_amount)
    const newRemaining = Number(existing.remaining_amount) + difference
    result = await one(
      "update monthly_budgets set allocated_amount = $2, remaining_amount = $3, updated_at = now() where id = $1 returning *",
      [existing.id, allocated_amount, Math.max(0, newRemaining)],
    )
  } else {
    result = await one(
      "insert into monthly_budgets (year, month, allocated_amount, remaining_amount) values ($1, $2, $3, $3) returning *",
      [year, month, allocated_amount],
    )
  }
  res.json(result)
}))

paymentsRouter.get("/reports/export", asyncHandler(async (req, res) => {
  const isAdminOrCashier = req.profile?.role === "admin" || req.profile?.fallback_role === "cashier"
  const exporterName = req.profile?.full_name || "Unknown User"

  const params: unknown[] = []
  let scope = ""
  if (!isAdminOrCashier) {
    params.push(req.user.id)
    scope = `where t.user_id = $${params.length}`
  }

  const data = await rows<any>(
    `select t.id, t.created_at, t.amount, t.recipient_phone, t.status,
            json_build_object('full_name', p.full_name) as profiles,
            (select coalesce(json_agg(json_build_object('name', tp.name, 'quantity', tp.quantity, 'price', tp.price)), '[]'::json)
               from transaction_products tp where tp.transaction_id = t.id) as transaction_products
       from corporate_transactions t
       join profiles p on p.id = t.user_id
       ${scope}
       order by t.created_at desc`,
    params,
  )

  const totalCount = data.length
  const completedCount = data.filter(tx => tx.status === "completed").length
  const pendingCount = data.filter(tx => tx.status === "pending").length
  const processingCount = data.filter(tx => tx.status === "processing").length
  const failedCount = data.filter(tx => tx.status === "failed").length

  const totalDisbursed = data
    .filter(tx => tx.status === "completed")
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0)

  let csv = isAdminOrCashier ? `"VERLET ROBOTICS - CORPORATE EXPENSE AUDIT LEDGER"\n` : `"VERLET ROBOTICS - PERSONAL EXPENSE REPORT"\n`
  csv += `"Generated On:","${new Date().toISOString()}"\n`
  csv += `"Exported By:","${exporterName.replace(/"/g, '""')}"\n`
  csv += `"Summary Stats:",\n`
  csv += `,"Total Transactions:",${totalCount}\n`
  csv += `,"Completed / Disbursed Payments:",${completedCount}\n`
  csv += `,"Total Funds Disbursed:",${totalDisbursed},"RWF"\n`
  csv += `,"Status Breakdown:","Completed: ${completedCount} | Pending: ${pendingCount} | Processing: ${processingCount} | Failed: ${failedCount}"\n`
  csv += `\n`
  csv += `"Transaction ID","Employee","Recipient Phone / Code","Product Name","Quantity","Unit Price (RWF)","Total Amount (RWF)","Status","Date Created"\n`

  for (const tx of data) {
    const employee = (tx.profiles as any)?.full_name || "Unknown"
    const date = new Date(tx.created_at).toISOString()
    const products = tx.transaction_products || []

    if (products.length === 0) {
      csv += `"${tx.id}","${employee.replace(/"/g, '""')}","${tx.recipient_phone}","N/A",0,0,${tx.amount},"${tx.status}","${date}"\n`
    } else {
      for (const product of products) {
        csv += `"${tx.id}","${employee.replace(/"/g, '""')}","${tx.recipient_phone}","${product.name.replace(/"/g, '""')}",${product.quantity},${product.price},${product.price * product.quantity},"${tx.status}","${date}"\n`
      }
    }
  }

  res.setHeader("Content-Type", "text/csv")
  res.setHeader("Content-Disposition", "attachment;filename=corporate_expense_report.csv")
  res.send(csv)
})
)

paymentsRouter.get("/reports/user/:id", requireAdmin, asyncHandler(async (req, res) => {
  const userId = req.params.id

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const totals = await one<{ daily_spent: number; monthly_spent: number; lifetime_spent: number }>(
    `select
       coalesce(sum(amount) filter (where created_at >= $2), 0) as daily_spent,
       coalesce(sum(amount) filter (where created_at >= $3), 0) as monthly_spent,
       coalesce(sum(amount), 0) as lifetime_spent
     from corporate_transactions
     where user_id = $1 and status = 'completed'`,
    [userId, todayStart, monthStart],
  )

  const recent = await rows<any>(
    `select t.id, t.amount, t.status, t.created_at, t.recipient_phone,
            l.name as location_name,
            (select coalesce(json_agg(json_build_object('name', tp.name, 'quantity', tp.quantity, 'price', tp.price)), '[]'::json)
               from transaction_products tp where tp.transaction_id = t.id) as products
       from corporate_transactions t
       left join locations l on l.id = t.location_id
      where t.user_id = $1
      order by t.created_at desc
      limit 10`,
    [userId],
  )

  res.json({
    daily_spent: Number(totals.daily_spent),
    monthly_spent: Number(totals.monthly_spent),
    lifetime_spent: Number(totals.lifetime_spent),
    recent_transactions: recent.map(tx => ({
      id: tx.id,
      amount: tx.amount,
      status: tx.status,
      created_at: tx.created_at,
      recipient_phone: tx.recipient_phone,
      location_name: tx.location_name ?? null,
      products: tx.products || [],
    })),
  })
}))

const detailedReportQuery = z.object({
  user_id: z.string().uuid().optional(),
  from: z.string().optional(), // ISO; t.created_at >= from
  to: z.string().optional(), //   ISO; t.created_at <= to (caller's job to push to end-of-day if wanted)
  // Free-text match against transaction_products.name/sku — there's no
  // item_id FK on transaction_products (products are a name/sku/spec
  // snapshot at purchase time), so this can't be a join on items.id.
  item: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(5000).default(2000),
})

/**
 * Admin audit report: corporate transactions filterable by user, item
 * (name/sku text match), and date range — the one combination none of the
 * existing payments endpoints support together (see /transactions, which has
 * no date/item filter, and /reports/user/:id, which is single-user only).
 */
paymentsRouter.get("/reports/detailed", requireAdmin, asyncHandler(async (req, res) => {
  const { user_id, from, to, item, limit } = detailedReportQuery.parse(req.query)

  const conditions: string[] = []
  const params: unknown[] = []

  if (user_id) {
    params.push(user_id)
    conditions.push(`t.user_id = $${params.length}`)
  }
  if (from) {
    params.push(from)
    conditions.push(`t.created_at >= $${params.length}`)
  }
  if (to) {
    params.push(to)
    conditions.push(`t.created_at <= $${params.length}`)
  }
  if (item) {
    params.push(`%${item}%`)
    conditions.push(
      `exists (select 1 from transaction_products tp where tp.transaction_id = t.id and (tp.name ilike $${params.length} or tp.type ilike $${params.length} or tp.model ilike $${params.length} or tp.sku ilike $${params.length}))`,
    )
  }
  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""
  params.push(limit)

  const data = await rows<any>(
    `select t.id, t.created_at, t.amount, t.status, t.payment_method, t.recipient_phone, t.failure_reason,
            json_build_object('full_name', p.full_name) as profiles,
            case when l.id is null then null else json_build_object('name', l.name) end as locations,
            ${TX_PRODUCTS}
       from corporate_transactions t
       join profiles p on p.id = t.user_id
       left join locations l on l.id = t.location_id
       ${where}
       order by t.created_at desc
       limit $${params.length}`,
    params,
  )

  const totalAmount = data.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0)
  const byStatus: Record<string, number> = {}
  for (const tx of data) {
    byStatus[tx.status] = (byStatus[tx.status] || 0) + 1
  }

  res.json({
    count: data.length,
    rows: data,
    summary: { totalAmount, byStatus },
  })
}))

paymentsRouter.get("/notifications", asyncHandler(async (req, res) => {
  const isAdminOrCashier = req.profile?.role === "admin" || req.profile?.fallback_role === "cashier"

  const params: unknown[] = []
  let scope = ""
  if (!isAdminOrCashier) {
    params.push(req.user.id)
    scope = `where t.user_id = $${params.length}`
  }

  const data = await rows<any>(
    `select t.id, t.status, t.amount, t.recipient_phone, t.failure_reason, t.created_at,
            t.item_photo_base64, t.receipt_base64,
            json_build_object('full_name', p.full_name) as profiles,
            (select coalesce(json_agg(json_build_object('name', tp.name)), '[]'::json)
               from transaction_products tp where tp.transaction_id = t.id) as transaction_products
       from corporate_transactions t
       join profiles p on p.id = t.user_id
       ${scope}
       order by t.created_at desc
       limit 20`,
    params,
  )

  const notifications = data.map((tx) => {
    const productName = tx.transaction_products?.[0]?.name || "Product"
    const employeeName = (tx.profiles as any)?.full_name || "An employee"
    let message = ""
    const reasonSuffix = tx.failure_reason ? ` (Reason: ${tx.failure_reason})` : ""

    if (tx.status === "completed") {
      message = isAdminOrCashier ? `${employeeName} paid RWF ${tx.amount} to ${tx.recipient_phone} for ${productName}.` : `Your payment of RWF ${tx.amount} for ${productName} succeeded.`
    } else if (tx.status === "failed") {
      message = isAdminOrCashier ? `Payment request by ${employeeName} for RWF ${tx.amount} failed${reasonSuffix}.` : `Your payment of RWF ${tx.amount} for ${productName} failed${reasonSuffix}.`
    } else {
      message = isAdminOrCashier ? `New pending payment request from ${employeeName} for RWF ${tx.amount}.` : `Your payment of RWF ${tx.amount} for ${productName} is processing.`
    }

    return {
      id: tx.id,
      type: tx.status,
      message,
      timestamp: tx.created_at,
    }
  })
  res.json(notifications)
}))

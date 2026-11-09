import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAuth, requireInventoryManager } from "../middleware/auth.js";
import { checkAndAlertLowStock, findLowStock } from "../low-stock.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireInventoryManager);

/** Read-only: items currently below the low-stock threshold (no emails sent). */
adminRouter.get(
  "/low-stock",
  asyncHandler(async (_req, res) => {
    res.json(await findLowStock());
  }),
);

/** Trigger a low-stock scan: emails admins about newly-low items (once each).
 *  Returns the count + the items alerted this run, plus any whose alert could
 *  not be delivered — those stay unrecorded and are retried on the next scan. */
adminRouter.post(
  "/check-low-stock",
  asyncHandler(async (_req, res) => {
    const { alerted, failed } = await checkAndAlertLowStock();
    res.json({ alerted: alerted.length, items: alerted, failed: failed.length });
  }),
);

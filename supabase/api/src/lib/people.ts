import type { Request } from "express";
import { HttpError } from "../http.js";
import { maybeOne } from "../db.js";
import { canManageInventory } from "../middleware/auth.js";

/**
 * Who a take/return is FOR: the caller, or — for a manager — another person.
 * The person must be an approved, unblocked account; recording against someone
 * who cannot sign in (or never got in) would put stock in the hands of nobody.
 */
export async function resolveHolder(req: Request, onBehalf: string | null | undefined): Promise<string> {
  if (!onBehalf || onBehalf === req.user.id) return req.user.id;
  if (!canManageInventory(req.profile)) {
    throw new HttpError(403, "Only a manager can record this for someone else.", "forbidden");
  }
  const person = await maybeOne<{ blocked: boolean; approval_status: string }>(
    "select blocked, approval_status from profiles where id = $1",
    [onBehalf],
  );
  if (!person) throw new HttpError(404, "That person was not found.", "user_not_found");
  if (person.blocked || person.approval_status !== "approved") {
    throw new HttpError(422, "That person's account is not active, so nothing can be recorded for them.", "user_not_active");
  }
  return onBehalf;
}

import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../http.js";
import { maybeOne } from "../db.js";

async function spentSince(userId: string, since: Date): Promise<number> {
  const row = await maybeOne<{ spent: number }>(
    `select coalesce(sum(amount), 0) as spent
       from corporate_transactions
      where user_id = $1 and status = 'completed' and created_at >= $2`,
    [userId, since.toISOString()],
  );
  return Number(row?.spent ?? 0);
}

export async function verifyLimits(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const amount = Number(req.body.amount);
    if (!amount || isNaN(amount) || amount <= 0) {
      throw new HttpError(400, "Invalid transaction amount.", "invalid_amount");
    }

    const profile = req.profile;
    if (!profile) {
      throw new HttpError(403, "Could not load user profile limits", "profile_load_failed");
    }

    const isAdminOrCashier = profile.role === "admin" || profile.fallback_role === "cashier";
    if (!isAdminOrCashier && !profile.has_payment_permission) {
      throw new HttpError(403, "You do not have corporate payment permissions", "no_payment_permission");
    }

    const perTxLimit = Number(profile.per_transaction_limit);
    if (perTxLimit > 0 && amount > perTxLimit) {
      throw new HttpError(
        422,
        `Transaction exceeeds your per-transaction limit of RWF ${perTxLimit}.`,
        "limit_per_transaction_exceeded",
      );
    }

    const dailyLimit = Number(profile.daily_limit);
    if (dailyLimit > 0) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const dailySpent = await spentSince(req.user.id, startOfDay);
      if (dailySpent + amount > dailyLimit) {
        throw new HttpError(
          422,
          `Transaction exceeds your daily limit. Remaining: RWF ${dailyLimit - dailySpent}`,
          "limit_daily_exceeded",
        );
      }
    }

    const monthlyLimit = Number(profile.monthly_limit);
    if (monthlyLimit > 0) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const monthlySpent = await spentSince(req.user.id, startOfMonth);
      if (monthlySpent + amount > monthlyLimit) {
        throw new HttpError(
          422,
          `Transaction exceeds your monthly limit. Remaining: RWF ${monthlyLimit - monthlySpent}`,
          "limit_monthly_exceeded",
        );
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

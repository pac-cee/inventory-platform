import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../http.js";
import { maybeOne } from "../db.js";
import { verifyAccessToken } from "../auth-service.js";

export type Profile = {
  id: string;
  full_name: string | null;
  role: string;
  blocked: boolean;
  fallback_role: string | null;
  has_payment_permission: boolean;
  can_manage_inventory: boolean;
  daily_limit: number;
  monthly_limit: number;
  per_transaction_limit: number;
} | null;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: { id: string; email: string };
      accessToken: string;
      sessionId: string;
      profile: Profile;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Require a valid access token. Verifies the HS256 JWT this API issued, then
 * attaches req.user, req.accessToken, req.sessionId, and the profile row.
 * A blocked or deleted user is rejected here on every request (immediate
 * effect) — the token itself cannot be withdrawn, so the check has to be the
 * account, on every request.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, "Missing or malformed Authorization header.", "no_token");

    let sub: string | undefined;
    let email = "";
    let sid = "";
    try {
      const { payload } = await verifyAccessToken(token);
      sub = payload.sub;
      email = (payload.email as string) ?? "";
      sid = (payload.sid as string) ?? "";
    } catch {
      throw new HttpError(401, "Invalid or expired session.", "invalid_token");
    }
    if (!sub) throw new HttpError(401, "Invalid or expired session.", "invalid_token");
    // Every token this API issues carries the session it belongs to. Without
    // one there is nothing to revoke against, so it cannot be honoured.
    if (!sid) throw new HttpError(401, "Invalid or expired session.", "invalid_token");

    req.user = { id: sub, email };
    req.accessToken = token;
    req.sessionId = sid;

    // Account state and session state in one round trip. This runs on every
    // authenticated request and the API talks to Neon across a region, so a
    // second query here would be a second latency hit on everything.
    const profile = await maybeOne<NonNullable<Profile> & { session_alive: boolean }>(
      `select p.id, p.full_name, p.role, p.blocked, p.fallback_role,
              p.has_payment_permission, p.can_manage_inventory,
              p.daily_limit, p.monthly_limit, p.per_transaction_limit,
              exists (
                select 1 from refresh_tokens r
                 where r.session_id = $2::uuid and r.revoked = false
              ) as session_alive
         from profiles p
        where p.id = $1`,
      [sub, sid],
    );

    // No profile row means the account is gone: deleting a user cascades to
    // profiles. The access token stays cryptographically valid until it
    // expires, so without this a deleted account keeps reading everything for
    // up to another hour. `profile?.blocked` alone did not catch it — undefined
    // is falsy, so a deleted user passed the block check by having no row at
    // all. Their refresh tokens cascade away too, so 401 ends the session for
    // good rather than bouncing through a refresh.
    if (!profile) {
      throw new HttpError(401, "This account no longer exists.", "account_not_found");
    }

    if (profile.blocked) {
      throw new HttpError(403, "Your account has been blocked. Contact an administrator.", "account_blocked");
    }

    // Signing out, being blocked, and any password change all revoke the
    // session's refresh tokens. An access token cannot be recalled once issued,
    // so that revocation only means anything if it is enforced here — otherwise
    // "sign out" left a working key in the browser for up to another hour.
    if (!profile.session_alive) {
      throw new HttpError(401, "This session has ended. Please sign in again.", "session_revoked");
    }

    req.profile = profile;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.profile?.role !== "admin") {
    next(new HttpError(403, "Admin privileges required.", "not_admin"));
    return;
  }
  next();
}

/**
 * Whether a profile may run the warehouse: an admin, a stock_manager, or a member
 * granted `can_manage_inventory`. The one definition of the rule — the guard below
 * and any in-route "a manager may override" check both use it.
 */
export function canManageInventory(
  profile: { role?: string | null; can_manage_inventory?: boolean | null } | null | undefined,
): boolean {
  return profile?.role === "admin" || profile?.role === "stock_manager" || !!profile?.can_manage_inventory;
}

/**
 * Running the warehouse: items, locations, movements and the stock reports.
 *
 * Deliberately NOT the same as requireAdmin. An admin manages money and people
 * as well; a stock_manager only manages stock, and `can_manage_inventory` grants
 * the same to an individual without changing their role.
 *
 * Nothing here grants payment approval — that is requireAdminOrCashier, which
 * accepts neither, so a stock manager is excluded by construction rather than by
 * a rule someone has to remember.
 */
export function requireInventoryManager(req: Request, _res: Response, next: NextFunction): void {
  if (!canManageInventory(req.profile)) {
    next(new HttpError(403, "Inventory management privileges required.", "not_inventory_manager"));
    return;
  }
  next();
}

export function requireAdminOrCashier(req: Request, _res: Response, next: NextFunction): void {
  const { role, fallback_role } = req.profile ?? {};
  if (role !== "admin" && fallback_role !== "cashier") {
    next(new HttpError(403, "Access restricted to admins and cashiers", "forbidden"));
    return;
  }
  next();
}

export function requirePaymentAccess(req: Request, _res: Response, next: NextFunction): void {
  const { role, fallback_role, has_payment_permission } = req.profile ?? {};
  const isAdminOrCashier = role === "admin" || fallback_role === "cashier";
  if (!isAdminOrCashier && !has_payment_permission) {
    next(new HttpError(403, "Access restricted to authorized payment users.", "forbidden"));
    return;
  }
  next();
}

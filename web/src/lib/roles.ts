/**
 * Who may do what, in one place.
 *
 * Two capabilities used to be the same thing — "is an admin" gated both running
 * the warehouse and running the money and the people. 0040 split them, so the
 * UI has to ask the right question rather than asking `role === "admin"` and
 * hoping. These mirror the API guards exactly:
 *
 *   canManageInventory  <->  requireInventoryManager
 *   isAdmin             <->  requireAdmin
 *   canApprovePayments  <->  requireAdminOrCashier
 */

export type Role = "member" | "admin" | "stock_manager";

/** What the UI needs to know about the signed-in person. */
export interface Capable {
  role?: Role | string | null;
  can_manage_inventory?: boolean | null;
  fallback_role?: string | null;
  has_payment_permission?: boolean | null;
}

/** Full run of the place: users, roles, budgets, payment approval. */
export function isAdmin(p: Capable | null | undefined): boolean {
  return p?.role === "admin";
}

/**
 * Add, edit and remove items, locations and stock, and read the stock reports.
 *
 * A stock_manager has this by role; a member can be granted it individually.
 * It says nothing about money — see canApprovePayments.
 */
export function canManageInventory(p: Capable | null | undefined): boolean {
  return isAdmin(p) || p?.role === "stock_manager" || !!p?.can_manage_inventory;
}

/**
 * Approve or reject someone's payment request.
 *
 * Deliberately excludes stock_manager and the inventory flag: running the
 * warehouse is not authority to release money.
 */
export function canApprovePayments(p: Capable | null | undefined): boolean {
  return isAdmin(p) || p?.fallback_role === "cashier";
}

/** Open the payments area at all — raising a request, not approving one. */
export function canUsePayments(p: Capable | null | undefined): boolean {
  return canApprovePayments(p) || !!p?.has_payment_permission;
}

/** How a role reads in the UI. */
export function roleLabel(role: Role | string | null | undefined): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "stock_manager":
      return "Stock manager";
    default:
      return "Member";
  }
}

/** The roles an admin can assign, in the order they should be offered. */
export const ASSIGNABLE_ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "member", label: "Member", hint: "Takes and returns stock." },
  {
    value: "stock_manager",
    label: "Stock manager",
    hint: "Adds items, locations and stock. Cannot approve payments.",
  },
  { value: "admin", label: "Admin", hint: "Everything, including users and payment approval." },
];

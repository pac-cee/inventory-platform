import { describe, it, expect } from "vitest";
import {
  ASSIGNABLE_ROLES,
  canApprovePayments,
  canManageInventory,
  canUsePayments,
  isAdmin,
  roleLabel,
} from "./roles";

/**
 * These mirror the API guards in src/middleware/auth.ts. If they drift, the UI
 * offers buttons the server refuses (or hides ones it would allow), so each
 * case here is deliberately the same case asserted there.
 */

describe("canManageInventory — mirrors requireInventoryManager", () => {
  it("an admin runs the warehouse", () => {
    expect(canManageInventory({ role: "admin" })).toBe(true);
  });

  it("a stock manager runs the warehouse", () => {
    expect(canManageInventory({ role: "stock_manager" })).toBe(true);
  });

  it("a member granted the flag runs the warehouse without the role", () => {
    expect(canManageInventory({ role: "member", can_manage_inventory: true })).toBe(true);
  });

  it("a plain member does not", () => {
    expect(canManageInventory({ role: "member" })).toBe(false);
    expect(canManageInventory({ role: "member", can_manage_inventory: false })).toBe(false);
  });

  it("is false for nobody signed in", () => {
    expect(canManageInventory(null)).toBe(false);
    expect(canManageInventory(undefined)).toBe(false);
  });
});

describe("canApprovePayments — running the warehouse is not authority over money", () => {
  it("a stock manager cannot approve, however inventory rights are granted", () => {
    expect(canApprovePayments({ role: "stock_manager" })).toBe(false);
    expect(canApprovePayments({ role: "member", can_manage_inventory: true })).toBe(false);
  });

  it("an admin and a cashier can", () => {
    expect(canApprovePayments({ role: "admin" })).toBe(true);
    expect(canApprovePayments({ role: "member", fallback_role: "cashier" })).toBe(true);
  });

  it("a plain member cannot", () => {
    expect(canApprovePayments({ role: "member" })).toBe(false);
  });
});

describe("canUsePayments — raising a request, not approving one", () => {
  it("needs an explicit grant for a stock manager", () => {
    expect(canUsePayments({ role: "stock_manager" })).toBe(false);
    expect(canUsePayments({ role: "stock_manager", has_payment_permission: true })).toBe(true);
  });

  it("anyone who can approve can also use it", () => {
    expect(canUsePayments({ role: "admin" })).toBe(true);
    expect(canUsePayments({ role: "member", fallback_role: "cashier" })).toBe(true);
  });
});

describe("isAdmin stays narrow", () => {
  it("is only the admin role", () => {
    expect(isAdmin({ role: "admin" })).toBe(true);
    expect(isAdmin({ role: "stock_manager" })).toBe(false);
    expect(isAdmin({ role: "member", can_manage_inventory: true })).toBe(false);
  });
});

describe("roleLabel", () => {
  it.each([
    ["admin", "Admin"],
    ["stock_manager", "Stock manager"],
    ["member", "Member"],
  ])("renders %s as %s", (role, expected) => {
    expect(roleLabel(role)).toBe(expected);
  });

  it("falls back to Member for anything unrecognised", () => {
    expect(roleLabel(null)).toBe("Member");
    expect(roleLabel("something_new")).toBe("Member");
  });
});

describe("ASSIGNABLE_ROLES", () => {
  it("offers every role the API accepts", () => {
    expect(ASSIGNABLE_ROLES.map((r) => r.value)).toEqual([
      "member",
      "stock_manager",
      "admin",
    ]);
  });

  it("says what the stock manager cannot do, since that is the point of it", () => {
    const sm = ASSIGNABLE_ROLES.find((r) => r.value === "stock_manager");
    expect(sm?.hint).toMatch(/cannot approve payments/i);
  });
});

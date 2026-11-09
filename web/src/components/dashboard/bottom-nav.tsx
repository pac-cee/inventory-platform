"use client";

import { CompactNav } from "./compact-nav";
import type { Role } from "@/lib/roles";

export function BottomNav({
  role,
  hasPaymentPermission = false,
}: {
  role: Role;
  hasPaymentPermission?: boolean;
}) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <CompactNav
        role={role}
        hasPaymentPermission={hasPaymentPermission}
        mobile
      />
    </nav>
  );
}

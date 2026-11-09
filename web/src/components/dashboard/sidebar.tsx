"use client";

import { VerletLogo } from "@/components/ui/verlet-logo";
import { CompactNav } from "./compact-nav";
import { roleLabel, type Role } from "@/lib/roles";

interface SidebarProps {
  role: Role;
  name: string;
  email: string;
  hasPaymentPermission?: boolean;
}

export function SidebarContent({
  role,
  hasPaymentPermission = false,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex size-9 items-center justify-center">
          <VerletLogo className="size-5" />
        </div>
        <span className="font-serif text-xl">Verlet</span>
      </div>
      <div className="mx-3 mb-3 rounded-2xl border border-border bg-card px-3 py-2.5">
        <p className="text-[11px] text-muted-foreground">{roleLabel(role)}</p>
        <p className="text-[13px] font-medium">Inventory</p>
      </div>
      <nav
        aria-label="Main navigation"
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2"
      >
        <CompactNav
          role={role}
          hasPaymentPermission={hasPaymentPermission}
          onNavigate={onNavigate}
        />
      </nav>
    </>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="fixed inset-y-5 left-5 z-30 hidden w-[224px] flex-col overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.10)] backdrop-blur-2xl md:flex">
      <SidebarContent {...props} />
    </aside>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { SearchBox } from "./search-box";
import { ScanButton } from "./scan-button";
import { UserMenu } from "./user-menu";
import { AdminNotifications } from "./admin-notifications";
import { LoansBell } from "./loans-bell";
import { VerletLogo } from "@/components/ui/verlet-logo";
import { type Role } from "@/lib/roles";

interface TopbarProps {
  name: string;
  email: string;
  role: Role;
}

export function Topbar({ name, email, role }: TopbarProps) {
  const home = usePathname() === "/";
  return (
    <header
      className={`relative z-30 h-20 items-center gap-3 px-4 sm:px-6 lg:px-8 ${home ? "grid grid-cols-[1fr_auto_1fr]" : "flex"}`}
    >
      <div className="min-w-0 flex-1">
        {!home && (
          <Suspense fallback={<div className="h-9" />}>
            <SearchBox />
          </Suspense>
        )}
        {home && (
          <span className="md:hidden">
            <VerletLogo className="size-6" />
          </span>
        )}
      </div>
      {home ? (
        <h1 className="font-serif text-3xl sm:text-[36px]">Home</h1>
      ) : (
        <span />
      )}
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <span className="hidden sm:inline-flex">
          <ScanButton />
        </span>
        <LoansBell />
        {/* Payment approvals are admin-only; a manager sees what a member sees here. */}
        <AdminNotifications
          role={role === "admin" ? "admin" : "member"}
          currentUserName={name}
        />
        <UserMenu name={name} email={email} />
      </div>
    </header>
  );
}

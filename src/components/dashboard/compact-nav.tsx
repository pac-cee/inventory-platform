"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Layers,
  Boxes,
  Warehouse,
  HandHelping,
  FileClock,
  Wallet,
  Users,
  Settings,
  Ellipsis,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { navigationFor } from "@/lib/navigation";
import type { Role } from "@/lib/roles";
import { cn } from "@/lib/utils";

const icons = {
  home: Home,
  map: Layers,
  inventory: Boxes,
  locations: Warehouse,
  borrowed: HandHelping,
  reports: FileClock,
  payments: Wallet,
  users: Users,
  settings: Settings,
};
export function CompactNav({
  role,
  hasPaymentPermission = false,
  mobile = false,
  onNavigate,
}: {
  role: Role;
  hasPaymentPermission?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { primary, more } = navigationFor(role, hasPaymentPermission);
  const active = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  const base = mobile
    ? "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px]"
    : "relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px]";
  const tone = (current: boolean) =>
    current
      ? "bg-nav-current text-foreground"
      : "text-muted-foreground hover:bg-hover hover:text-foreground";
  const moreActive = more.some((item) => active(item.href));
  return (
    <>
      {primary.map((item) => {
        const Icon = icons[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active(item.href) ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              base,
              tone(active(item.href)),
              "font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Icon className={mobile ? "size-5" : "size-4"} />
            {item.label}
          </Link>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            base,
            tone(moreActive),
            "font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="More navigation"
        >
          <Ellipsis className={mobile ? "size-5" : "size-4"} />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={mobile ? "top" : "right"}
          align={mobile ? "end" : "start"}
          sideOffset={10}
          className="min-w-48"
        >
          {more.map((item) => {
            const Icon = icons[item.icon];
            return (
              <DropdownMenuItem key={item.href} asChild>
                <Link
                  href={item.href}
                  aria-current={active(item.href) ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5",
                    active(item.href) && "bg-nav-current",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

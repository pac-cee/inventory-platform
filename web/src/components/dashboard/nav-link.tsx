"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  active: boolean;
  className: string;
  children: React.ReactNode;
  onClick?: () => void;
}

// Wraps <Link> with a debounced pending hint so a click *feels* captured
// even before the route's loading.tsx skeleton swaps in (slow networks).
// 100ms delay + opacity-0 start => only shows if navigation actually stalls.
export function NavLink({
  href,
  active,
  className,
  children,
  onClick,
}: NavLinkProps) {
  const { pending } = useLinkStatus();
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(className, pending && "opacity-70")}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          "ml-auto h-1.5 w-1.5 rounded-full bg-highlight transition-opacity",
          // invisible until 100ms (handled via CSS animation delay below)
          pending ? "animate-pending-dot" : "opacity-0",
        )}
      />
    </Link>
  );
}

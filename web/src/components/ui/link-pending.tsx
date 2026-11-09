"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Place inside a <Link>: a small dot that appears only if the navigation is
 * still going after ~100ms (the same debounce the sidebar uses), so fast clicks
 * stay quiet but a slow one clearly says "got it, loading".
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current", pending ? "animate-pending-dot" : "hidden", className)}
    />
  );
}

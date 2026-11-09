"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Loan } from "@/lib/api/types";
import { loansNeedingAttention } from "@/lib/loan-attention";
import { dueLabel } from "@/lib/return-by";

/**
 * "Equipment due": what you have out that is late, due today or due tomorrow.
 * Computed from your loans on every look — nothing is stored — so it is always
 * right, and it disappears the moment you return the thing. Stays out of the way
 * (no icon at all) when there is nothing to bring back.
 */
export function LoansBell() {
  const [loans, setLoans] = useState<Loan[]>([]);

  useEffect(() => {
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch("/api/loans");
        // An expired session redirects to the login page: HTML, not JSON.
        if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
          setLoans((await res.json()) as Loan[]);
        }
      } catch {
        /* a failed poll just leaves the last answer on screen */
      } finally {
        inFlight = false;
      }
    };
    load();
    const t = setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const attention = loansNeedingAttention(loans);
  if (attention.length === 0) return null;
  const anyLate = attention.some((l) => l.status === "overdue");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${attention.length} item${attention.length === 1 ? "" : "s"} to bring back`}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-highlight/25"
        >
          <PackageCheck className="h-5 w-5" />
          <span
            className={`absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ${
              anyLate ? "bg-destructive text-white" : "bg-highlight text-highlight-foreground"
            }`}
          >
            {attention.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[400px] w-80 overflow-y-auto p-2">
        <DropdownMenuLabel className="px-2 py-1.5 font-serif text-[13px] text-foreground">Equipment to bring back</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {attention.map((l) => {
          const due = dueLabel(l);
          return (
            <DropdownMenuItem key={l.take_id} asChild className="cursor-pointer rounded-lg p-2.5">
              <Link href={`/items/${l.item_id}`} className="flex w-full flex-col items-start gap-0.5">
                <span className="w-full truncate text-[12px] font-semibold text-foreground">
                  {l.quantity} × {l.item_name}
                </span>
                <span
                  className={`text-[11px] ${
                    due.tone === "bad" ? "font-medium text-destructive" : due.tone === "warn" ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                  }`}
                >
                  {due.text}
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Download, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Loan, ReportRow } from "@/lib/api/types";
import { feedItemLabel, feedSentence, feedTime, groupFeed } from "@/lib/activity-feed";
import { filterLoans, groupByPerson, loansToCsv, summarize, type StatusFilter } from "@/lib/equipment-audit";
import { dueLabel } from "@/lib/return-by";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "due_today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "none", label: "No date" },
];

const TONE = { muted: "text-muted-foreground", warn: "text-amber-600 dark:text-amber-400", bad: "text-red-600 dark:text-red-400" } as const;

export function EquipmentAudit({
  loans,
  loadError,
  recent,
  recentError,
}: {
  loans: Loan[];
  loadError: string | null;
  recent: ReportRow[];
  recentError: string | null;
}) {
  // "out" = who holds what now; "recent" = who took or returned what lately.
  const [mode, setMode] = useState<"out" | "recent">("out");
  const days = useMemo(() => groupFeed(recent), [recent]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => filterLoans(loans, status, query), [loans, status, query]);
  const groups = useMemo(() => groupByPerson(shown), [shown]);
  const totals = summarize(shown);

  function exportCsv() {
    const blob = new Blob([loansToCsv(shown)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `borrowed-equipment-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.75rem] text-foreground">Borrowed equipment</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who is holding what, and when it is due back.</p>
        </div>
        {mode === "out" ? (
          <Button type="button" variant="outline" onClick={exportCsv} disabled={shown.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        ) : null}
      </div>

      <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="View">
        {(
          [
            ["out", "Out now"],
            ["recent", "Recent activity"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === value ? "bg-highlight text-highlight-foreground" : "text-muted-foreground hover:bg-hover"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "recent" ? (
        <RecentActivity days={days} error={recentError} />
      ) : (
        <>

      {loadError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Loans", totals.loans],
          ["Units out", totals.units],
          ["People", totals.people],
          ["Overdue", totals.overdue],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-semibold ${label === "Overdue" && Number(value) > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Person, item or place" className="pl-9" aria-label="Filter loans" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                status === f.value ? "border-transparent bg-highlight text-highlight-foreground" : "border-border text-muted-foreground hover:bg-hover"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {loans.length === 0 ? "Nothing is borrowed right now." : "No loans match those filters."}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.user_id} className="overflow-hidden rounded-lg border border-border">
              <header className="flex flex-wrap items-center justify-between gap-2 bg-surface-2/40 px-4 py-3">
                <h2 className="font-medium text-foreground">{g.user_name}</h2>
                <p className="text-xs text-muted-foreground">
                  {g.units} unit{g.units === 1 ? "" : "s"}
                  {g.overdue > 0 ? <span className="ml-2 font-medium text-red-600 dark:text-red-400">{g.overdue} overdue</span> : null}
                </p>
              </header>
              <ul className="divide-y divide-line">
                {g.loans.map((l) => {
                  const due = dueLabel(l);
                  return (
                    <li key={l.take_id}>
                      <Link href={`/items/${l.item_id}?at=${l.location_id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2/40">
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {l.quantity} × {l.item_name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {l.location_name} · taken {l.taken_at.slice(0, 10)}
                          </span>
                        </span>
                        <span className={`shrink-0 text-xs font-medium ${TONE[due.tone]}`}>{due.text}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

/** The last 30 days of takes, returns and damage, a day at a time. */
function RecentActivity({ days, error }: { days: ReturnType<typeof groupFeed>; error: string | null }) {
  if (error) {
    return <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">{error}</div>;
  }
  if (days.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
        Nothing taken or returned in the last 30 days.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {days.map((d) => (
        <section key={d.label}>
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.label}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-border">
            {d.rows.map((r) => {
              const Icon = r.reason === "take" ? ArrowUpRight : r.reason === "return" ? ArrowDownLeft : TriangleAlert;
              const tone =
                r.reason === "take" ? "text-highlight" : r.reason === "return" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
              return (
                <li key={r.id}>
                  <Link
                    href={`/items/${r.item.id}`}
                    title={feedItemLabel(r)}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2/40"
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">{feedSentence(r)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.location.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{feedTime(r.created_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

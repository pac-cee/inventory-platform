"use client";

import { useMemo, useState, useTransition } from "react";
import { FileClock, Printer, Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel } from "@/components/dashboard/widgets";
import { locationLabel } from "@/lib/locations";
import { runReport, type ReportFilters } from "@/app/(app)/reports/actions";
import type { ActivityReport, Item, Location, Profile } from "@/lib/api/types";

/** Selectable activity types (value = ledger reason). */
const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "take", label: "Taken" },
  { value: "return", label: "Returned" },
  { value: "destroyed", label: "Damaged" },
  { value: "lost", label: "Lost" },
  { value: "finish", label: "Finished" },
  { value: "repair", label: "Repaired" },
  { value: "initial", label: "Stocked" },
  { value: "adjust", label: "Adjusted" },
];

const ALL = "__all__";

function startOfDay(d: string) {
  return d ? `${d}T00:00:00` : undefined;
}
function endOfDay(d: string) {
  return d ? `${d}T23:59:59.999` : undefined;
}
function isoDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function ActivityReport({
  locations,
  items,
  profiles,
}: {
  locations: Location[];
  items: Item[];
  profiles: Profile[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [locationId, setLocationId] = useState(ALL);
  const [itemId, setItemId] = useState(ALL);
  const [userId, setUserId] = useState(ALL);
  const [personField, setPersonField] = useState<"attributed" | "actor">("attributed");
  const [reasons, setReasons] = useState<string[]>([]);
  const [includeUndone, setIncludeUndone] = useState(false);

  const [report, setReport] = useState<ActivityReport | null>(null);
  // Open until a report has run; then folded away so the results are not
  // pushed below a screen of controls. "Change filters" brings it back.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // All locations, sorted by their full path, for the location filter.
  const locOptions = useMemo(
    () =>
      locations
        .map((l) => ({ id: l.id, label: locationLabel(l, locations) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [locations],
  );
  const itemOptions = useMemo(
    () =>
      [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const userOptions = useMemo(
    () =>
      [...profiles].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")),
    [profiles],
  );

  function toggleReason(v: string) {
    setReasons((r) => (r.includes(v) ? r.filter((x) => x !== v) : [...r, v]));
  }

  function preset(days: number | "month") {
    setTo(isoDate(0));
    if (days === "month") {
      const d = new Date();
      setFrom(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10));
    } else {
      setFrom(isoDate(days));
    }
  }

  function submit() {
    setError(null);
    const filters: ReportFilters = {
      from: startOfDay(from),
      to: endOfDay(to),
      location_id: locationId === ALL ? undefined : locationId,
      item_id: itemId === ALL ? undefined : itemId,
      user_id: userId === ALL ? undefined : userId,
      person_field: personField,
      reason: reasons.length ? reasons : undefined,
      include_undone: includeUndone,
    };
    startTransition(async () => {
      const res = await runReport(filters);
      if (res.error) {
        setError(res.error);
        setReport(null);
      } else {
        setReport(res.report ?? null);
        if (res.report) setFiltersOpen(false);
      }
    });
  }

  function reset() {
    setFrom("");
    setTo("");
    setLocationId(ALL);
    setItemId(ALL);
    setUserId(ALL);
    setPersonField("attributed");
    setReasons([]);
    setIncludeUndone(false);
    setReport(null);
    setError(null);
    setFiltersOpen(true);
  }

  const summary = [
    from || to ? `${from || "start"} → ${to || "today"}` : "All dates",
    locationId !== ALL ? "one location" : null,
    itemId !== ALL ? "one item" : null,
    userId !== ALL ? "one person" : null,
    reasons.length ? `${reasons.length} activity type${reasons.length === 1 ? "" : "s"}` : null,
    includeUndone ? "incl. undone" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function exportCsv() {
    if (!report) return;
    // Mirrors the row order below: type, name, model, SKU.
    const head = ["When", "Action", "Units", "Item type", "Name", "Model", "Specification", "SKU", "Location", "Attributed to", "Recorded by", "Note", "Undone"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    for (const r of report.rows) {
      lines.push(
        [
          new Date(r.created_at).toLocaleString(),
          r.label,
          r.units,
          r.item.type,
          r.item.name,
          r.item.model,
          r.item.specification ?? "",
          r.item.sku,
          r.location.name,
          r.person.name ?? "",
          r.actor.name ?? "",
          r.note ?? "",
          r.reversed ? "yes" : "",
        ]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Filters — hidden when printing. */}
      <Panel
        title="Filters"
        action={
          report ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="print:hidden"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              {filtersOpen ? "Hide filters" : "Change filters"}
            </Button>
          ) : undefined
        }
      >
        {!filtersOpen ? (
          <p className="px-5 py-3 text-sm text-muted-foreground print:hidden">{summary}</p>
        ) : null}
        <div className={`space-y-5 p-5 print:hidden ${filtersOpen ? "" : "hidden"}`}>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground self-center">Quick range:</span>
            <Button type="button" variant="outline" size="sm" onClick={() => preset(0)}>Today</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => preset(7)}>Last 7 days</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => preset(30)}>Last 30 days</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => preset("month")}>This month</Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="rp-from">From</Label>
              <Input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rp-to">To</Label>
              <Input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rp-location">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="rp-location"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All locations</SelectItem>
                  {locOptions.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Includes everything nested inside it.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rp-item">Item</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger id="rp-item"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All items</SelectItem>
                  {itemOptions.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.type}{it.sku ? ` · ${it.sku}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Activity type</Label>
            <div className="flex flex-wrap gap-2">
              {REASON_OPTIONS.map((r) => {
                const on = reasons.includes(r.value);
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => toggleReason(r.value)}
                    className={
                      "rounded-full border px-3 py-1 text-sm transition-colors " +
                      (on
                        ? "border-highlight bg-highlight text-highlight-foreground"
                        : "border-line text-muted-foreground hover:bg-card")
                    }
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">None selected = every activity type.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rp-user">Person</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="rp-user"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Everyone</SelectItem>
                  {userOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name || "Unknown"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rp-personfield">Match person as</Label>
              <Select value={personField} onValueChange={(v) => setPersonField(v as "attributed" | "actor")}>
                <SelectTrigger id="rp-personfield"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="attributed">Who it&apos;s attributed to</SelectItem>
                  <SelectItem value="actor">Who recorded it</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                E.g. damage an admin pinned on someone = attributed to them.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={includeUndone}
              onChange={(e) => setIncludeUndone(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-highlight"
            />
            Include undone / reversed entries
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={submit} disabled={pending}>
              <Search className="h-4 w-4" />
              {pending ? "Running…" : "Run report"}
            </Button>
            <Button type="button" variant="outline" onClick={reset} disabled={pending}>
              <X className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>
      </Panel>

      {report ? (
        <>
          {/* Print header — only visible on paper. */}
          <div className="hidden print:block">
            <h2 className="font-serif text-xl">Activity report</h2>
            <p className="text-sm text-muted-foreground">
              {from || "the beginning"} → {to || "now"} · {report.count} activities
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-fg">{report.count}</span> activities match.
            </p>
            <div className="flex gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()} disabled={report.count === 0}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={report.count === 0}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>

          {report.count > 0 ? (
            <div className="grid gap-4 lg:grid-cols-3 print:hidden">
              <SummaryCard title="By activity" buckets={report.summary.byReason} />
              <SummaryCard title="By person" buckets={report.summary.byPerson} />
              <SummaryCard title="By item" buckets={report.summary.byItem} />
            </div>
          ) : null}

          <Panel title="Activities">
            {report.count === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No activities match these filters.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-5">When</TableHead>
                    <TableHead className="px-5">Action</TableHead>
                    <TableHead className="px-5">Item</TableHead>
                    <TableHead className="px-5">Location</TableHead>
                    <TableHead className="px-5">Attributed to</TableHead>
                    <TableHead className="px-5">Recorded by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.id} className={r.reversed ? "opacity-50" : ""}>
                      <TableCell className="px-5 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-5">
                        <span className="font-medium text-fg">{r.label}</span>
                        {r.reversed ? <span className="ml-2 text-xs text-muted-foreground">(undone)</span> : null}
                        {r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
                      </TableCell>
                      <TableCell className="px-5 text-fg">
                        {r.item.type}
                        <span className="text-muted-foreground">
                          {" · "}{r.item.name} · <span className="font-mono">{r.item.sku}</span>
                        </span>
                      </TableCell>
                      <TableCell className="px-5 text-muted-foreground">{r.location.name}</TableCell>
                      <TableCell className="px-5 text-fg">{r.person.name || "—"}</TableCell>
                      <TableCell className="px-5 text-muted-foreground">
                        {r.actor.name && r.actor.id !== r.person.id ? r.actor.name : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      ) : (
        <Panel title="Activities">
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <FileClock className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Choose filters and run the report to see matching activities.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}

function SummaryCard({ title, buckets }: { title: string; buckets: { key: string; name: string; count: number; units: number }[] }) {
  const top = buckets.slice(0, 8);
  return (
    <Panel title={title}>
      {top.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">Nothing to show.</p>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((b) => (
            <li key={b.key} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span className="truncate pr-3 text-fg">{b.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {b.count} → {b.units} units
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

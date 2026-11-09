"use client";

import { useMemo, useState } from "react";
import { FileClock, Download, Search, X, FileText } from "lucide-react";
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
import type { DetailedPaymentReport, Profile } from "@/lib/api/types";

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

function itemsSummary(row: DetailedPaymentReport["rows"][number]): string {
  return row.transaction_products
    .map((p) => [p.type, p.name, p.model].filter(Boolean).join(" · ") || p.name)
    .join("; ");
}

export function PaymentsDetailedReport({
  profiles,
  preparedBy = null,
}: {
  profiles: Profile[];
  preparedBy?: string | null;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState(ALL);
  const [item, setItem] = useState("");

  const [report, setReport] = useState<DetailedPaymentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const userOptions = useMemo(
    () => [...profiles].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")),
    [profiles],
  );

  function preset(days: number | "month") {
    setTo(isoDate(0));
    if (days === "month") {
      const d = new Date();
      setFrom(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10));
    } else {
      setFrom(isoDate(days));
    }
  }

  async function submit() {
    setError(null);
    setPending(true);
    try {
      const params = new URLSearchParams();
      const fromIso = startOfDay(from);
      const toIso = endOfDay(to);
      if (fromIso) params.set("from", fromIso);
      if (toIso) params.set("to", toIso);
      if (userId !== ALL) params.set("user_id", userId);
      if (item.trim()) params.set("item", item.trim());

      const res = await fetch(`/api/payments/reports/detailed?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not run the report.");
        setReport(null);
      } else {
        setReport(data as DetailedPaymentReport);
      }
    } catch {
      setError("Could not run the report.");
      setReport(null);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setFrom("");
    setTo("");
    setUserId(ALL);
    setItem("");
    setReport(null);
    setError(null);
  }

  function exportCsv() {
    if (!report) return;
    const head = ["Date", "User", "Items", "Amount", "Status", "Payment method", "Location"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    for (const r of report.rows) {
      lines.push(
        [
          new Date(r.created_at).toLocaleString(),
          r.profiles.full_name ?? "",
          itemsSummary(r),
          r.amount,
          r.status,
          r.payment_method ?? "",
          r.locations?.name ?? "",
        ]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    if (!report) return;
    const { downloadPaymentsReportPdf } = await import("@/lib/reports/payments-pdf");
    await downloadPaymentsReportPdf(report.rows, { preparedBy });
  }

  return (
    <div className="space-y-6">
      <Panel title="Filters">
        <div className="space-y-5 p-5 print:hidden">
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground self-center">Quick range:</span>
            <Button type="button" variant="outline" size="sm" onClick={() => preset(0)}>Today</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => preset(7)}>Last 7 days</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => preset(30)}>Last 30 days</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => preset("month")}>This month</Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="pr-from">From</Label>
              <Input id="pr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-to">To</Label>
              <Input id="pr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-user">User</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="pr-user"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Everyone</SelectItem>
                  {userOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name || "Unknown"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pr-item">Item (name or SKU)</Label>
              <Input
                id="pr-item"
                value={item}
                onChange={(e) => setItem(e.target.value)}
                placeholder="e.g. Laptop or SKU-1234"
              />
            </div>
          </div>

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
          <div className="hidden print:block">
            <h2 className="font-serif text-xl">Detailed payments report</h2>
            <p className="text-sm text-muted-foreground">
              {from || "the beginning"} → {to || "now"} · {report.count} transactions
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-fg">{report.count}</span> transactions match ·{" "}
              <span className="font-medium text-fg">{report.summary.totalAmount.toLocaleString()}</span> total
            </p>
            <div className="flex gap-3">
              <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={report.count === 0}>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={exportPdf} disabled={report.count === 0}>
                <FileText className="h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </div>

          {report.count > 0 ? (
            <Panel title="By status">
              <ul className="divide-y divide-line">
                {Object.entries(report.summary.byStatus).map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="capitalize text-fg">{status}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Transactions">
            {report.count === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No transactions match these filters.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-5">Date</TableHead>
                    <TableHead className="px-5">User</TableHead>
                    <TableHead className="px-5">Items</TableHead>
                    <TableHead className="px-5">Amount</TableHead>
                    <TableHead className="px-5">Status</TableHead>
                    <TableHead className="px-5">Location</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="px-5 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-5 text-fg">{r.profiles.full_name ?? "—"}</TableCell>
                      <TableCell className="px-5 text-fg">{itemsSummary(r) || "—"}</TableCell>
                      <TableCell className="px-5 tabular-nums text-fg">{r.amount.toLocaleString()}</TableCell>
                      <TableCell className="px-5 capitalize text-muted-foreground">{r.status}</TableCell>
                      <TableCell className="px-5 text-muted-foreground">{r.locations?.name ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      ) : (
        <Panel title="Transactions">
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <FileClock className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Choose filters and run the report to see matching transactions.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}

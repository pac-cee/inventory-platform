"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { ClipboardList, Printer, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { runConditionReport } from "@/app/(app)/reports/actions";
import { conditionText, recommendationText } from "@/lib/reports/condition";
import {
  groupVariants,
  variantsText,
  groupConditionText,
  groupRecommendationText,
  groupPercent,
  locationsText,
  nestByName,
  namePercent,
  skuText,
  itemText,
  type GroupedRow,
  type GroupMode,
} from "@/lib/reports/condition-group";
import type { ConditionRow, Location } from "@/lib/api/types";

const ALL = "__all__";

// Re-exported for callers that imported these from here before they moved to lib.
export { conditionText, recommendationText };

/** Red when most units are down, amber when some are, plain when all is well. */
function percentTone(pct: number): string {
  if (pct >= 100) return "text-muted-foreground";
  if (pct >= 50) return "text-amber-600 dark:text-amber-500";
  return "text-destructive";
}

export function ConditionReport({
  locations,
  categories,
  preparedBy = null,
}: {
  locations: Location[];
  categories: string[];
  /** Signed-in person, printed on the PDF as its author. */
  preparedBy?: string | null;
}) {
  const [locationId, setLocationId] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [faultyOnly, setFaultyOnly] = useState(false);
  // Item-first by default: the report is about what you own, and where it sits
  // is a detail printed beside it.
  const [mode, setMode] = useState<GroupMode>("item");

  const [rows, setRows] = useState<ConditionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const locOptions = useMemo(
    () =>
      locations
        .map((l) => ({ id: l.id, label: locationLabel(l, locations) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [locations],
  );

  /**
   * Room -> category -> rows, matching the printed layout. The API already
   * orders by room, then category, then item, so grouping preserves that.
   */
  const grouped = useMemo(() => {
    if (!rows) return [];
    // Variants of one product collapse into a single line first, so the table,
    // CSV and PDF all count the same way.
    const lines = groupVariants(rows, mode);
    const rooms = new Map<string, { name: string; categories: Map<string, GroupedRow[]> }>();
    for (const r of lines) {
      // Item mode has no room dimension — everything lands in one bucket.
      const bucket = mode === "item" ? "all" : r.room_id;
      const room = rooms.get(bucket) ?? { name: r.room_name, categories: new Map() };
      const key = r.category ?? "Uncategorised";
      room.categories.set(key, [...(room.categories.get(key) ?? []), r]);
      rooms.set(bucket, room);
    }
    return [...rooms.entries()].map(([id, room]) => ({
      id,
      name: room.name,
      categories: [...room.categories.entries()].map(([name, items]) => ({ name, items })),
    }));
  }, [rows, mode]);

  const totals = useMemo(() => {
    if (!rows) return null;
    const units = rows.reduce((n, r) => n + r.total, 0);
    const operational = rows.reduce((n, r) => n + r.operational, 0);
    return {
      lines: rows.length,
      units,
      operational,
      damaged: units - operational,
      pct: units > 0 ? Math.round((operational / units) * 1000) / 10 : 0,
    };
  }, [rows]);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await runConditionReport({
        location_id: locationId === ALL ? undefined : locationId,
        category: category === ALL ? undefined : category,
        faulty_only: faultyOnly || undefined,
      });
      if (res.error) {
        setError(res.error);
        setRows(null);
        return;
      }
      setRows(res.rows ?? []);
    });
  }

  // jsPDF is fetched on click, so it never lands in the initial bundle.
  async function downloadPdf() {
    if (!grouped.length) return;
    setPdfBusy(true);
    try {
      const { downloadConditionPdf } = await import("@/lib/reports/condition-pdf");
      await downloadConditionPdf(grouped, { preparedBy });
    } catch {
      setError("Could not build the PDF. Try Print instead.");
    } finally {
      setPdfBusy(false);
    }
  }

  function exportCsv() {
    if (!rows) return;
    const head = [
      "Location",
      "Category",
      "Item type",
      "Name",
      "Model",
      "SKU",
      "Specification",
      "Quantity",
      "Condition",
      "% Operational",
      "Recommendation",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    // Same grouped lines the table and PDF print.
    for (const r of groupVariants(rows, mode)) {
      lines.push(
        [
          locationsText(r),
          r.category ?? "",
          r.type,
          r.name,
          r.model,
          skuText(r),
          variantsText(r),
          r.total,
          groupConditionText(r),
          `${groupPercent(r)}%`,
          groupRecommendationText(r),
        ]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `condition-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Panel title="Filters">
        <div className="space-y-5 p-5 print:hidden">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cr-location">Room or location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="cr-location">
                  <SelectValue placeholder="Everywhere" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Everywhere</SelectItem>
                  {locOptions.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Picking a room includes everything shelved inside it.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cr-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="cr-category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cr-faulty">Show</Label>
              <Select
                value={faultyOnly ? "faulty" : "all"}
                onValueChange={(v) => setFaultyOnly(v === "faulty")}
              >
                <SelectTrigger id="cr-faulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everything</SelectItem>
                  <SelectItem value="faulty">Only what needs attention</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={run} disabled={pending}>
              {pending ? "Running…" : "Run report"}
            </Button>
            {rows ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLocationId(ALL);
                  setCategory(ALL);
                  setFaultyOnly(false);
                  setRows(null);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </Panel>

      {rows === null ? (
        <Panel title="Condition">
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <ClipboardList className="size-6 opacity-60" aria-hidden />
            <p>Choose a room and run the report to see what state everything is in.</p>
          </div>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel title="Condition">
          <p className="p-10 text-center text-sm text-muted-foreground">
            Nothing stocked matches those filters.
          </p>
        </Panel>
      ) : (
        <div className="space-y-6">
          {/* Printed header — the on-screen chrome is hidden on paper. */}
          <div className="hidden print:block">
            <h2 className="font-serif text-xl">Condition report</h2>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleString()} · {totals?.lines} lines · {totals?.units} units ·{" "}
              {totals?.pct}% operational
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{totals?.units}</strong> units across{" "}
              {totals?.lines} lines ·{" "}
              <strong className={percentTone(totals?.pct ?? 0)}>{totals?.pct}%</strong> operational
              {totals && totals.damaged > 0 ? ` · ${totals.damaged} out of service` : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Item-first vs room-by-room. */}
              <div className="flex gap-1 rounded-lg border border-line p-0.5 text-xs">
                {(
                  [
                    ["item", "By item"],
                    ["location", "By location"],
                  ] as [GroupMode, string][]
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-md px-2.5 py-1 ${
                      mode === m
                        ? "bg-card text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                Print
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pdfBusy}
                onClick={downloadPdf}
              >
                <FileText className="size-4" aria-hidden />
                {pdfBusy ? "Preparing…" : "Download PDF"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
                <Download className="size-4" aria-hidden />
                Export CSV
              </Button>
            </div>
          </div>

          {grouped.map((room) => (
            <Panel key={room.id} title={mode === "item" ? "All items" : room.name}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[11%]">Category</TableHead>
                      {/* Name, then its SKU beneath — different SKUs are
                          different items, so each keeps its own line. */}
                      <TableHead className="w-[15%]">Item type / name / SKU</TableHead>
                      <TableHead className="w-[13%]">Specification</TableHead>
                      <TableHead className="w-[12%]">Location</TableHead>
                      <TableHead className="w-[7%] text-right">Quantity</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead className="w-[9%] text-right">% Operational</TableHead>
                      <TableHead className="w-[15%]">Recommendation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {room.categories.map((cat) =>
                      nestByName(cat.items).map((nameGroup, gi) => {
                        const multi = nameGroup.lines.length > 1;
                        return (
                          <Fragment key={nameGroup.key}>
                            {/* When a name covers several SKUs, it gets its own
                                heading row carrying the combined total. Each SKU
                                then keeps its own line and its own numbers,
                                because different SKUs are different items. */}
                            {multi ? (
                              <TableRow className="bg-muted/40">
                                <TableCell className="align-top text-sm text-muted-foreground">
                                  {gi === 0 ? cat.name : ""}
                                </TableCell>
                                <TableCell className="font-medium">{nameGroup.name}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {nameGroup.lines.map(itemText).join(" · ")}
                                </TableCell>
                                <TableCell />
                                <TableCell className="text-right tabular-nums font-medium">
                                  {nameGroup.total}
                                </TableCell>
                                <TableCell />
                                <TableCell
                                  className={`text-right tabular-nums ${percentTone(namePercent(nameGroup))}`}
                                >
                                  {namePercent(nameGroup)}%
                                </TableCell>
                                <TableCell />
                              </TableRow>
                            ) : null}

                            {nameGroup.lines.map((r) => {
                              const pct = groupPercent(r);
                              return (
                                <TableRow key={r.key}>
                                  <TableCell className="align-top text-sm text-muted-foreground">
                                    {!multi && gi === 0 ? cat.name : ""}
                                  </TableCell>
                                  <TableCell className={`align-top ${multi ? "pl-8" : ""}`}>
                                    {multi ? null : (
                                      <span className="font-medium">{r.type}</span>
                                    )}
                                    <span
                                      className={
                                        multi
                                          ? "text-sm text-fg"
                                          : "block text-xs text-muted-foreground"
                                      }
                                    >
                                      {itemText(r)}
                                    </span>
                                    {/* The assigned code, on its own line so it
                                        stays readable next to the name. */}
                                    <span className="block font-mono text-xs text-muted-foreground">
                                      {skuText(r)}
                                    </span>
                                  </TableCell>
                                  <TableCell className="align-top text-sm">
                                    {variantsText(r)}
                                  </TableCell>
                                  <TableCell className="align-top text-xs text-muted-foreground">
                                    {locationsText(r)}
                                  </TableCell>
                                  <TableCell className="align-top text-right tabular-nums">
                                    {r.total}
                                    {r.in_use > 0 ? (
                                      <span className="block text-xs text-muted-foreground">
                                        {r.in_use} in use
                                      </span>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="align-top text-sm">
                                    {groupConditionText(r)}
                                  </TableCell>
                                  <TableCell
                                    className={`align-top text-right tabular-nums ${percentTone(pct)}`}
                                  >
                                    {pct}%
                                  </TableCell>
                                  <TableCell className="align-top text-sm">
                                    {groupRecommendationText(r) || (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </Fragment>
                        );
                      }),
                    )}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

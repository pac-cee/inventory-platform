"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Printer } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { boxQrData } from "@/lib/box-qr";
import { cn } from "@/lib/utils";

export interface BoxLabel {
  id: string;
  token: string;
  /** What the box is for ("USB-A to C cables"); the name when it has no label. */
  title: string;
  /** Where it is: Hardware Area › Shelves › Shelf 2 › Level 3. */
  path: string;
}

// Which labels this browser has already printed, so yesterday's sheet is not
// printed again. Kept in the browser (no server record yet): it is a memory aid,
// not a source of truth — another computer starts with a blank slate.
const PRINTED_KEY = "box-labels-printed";
const PRINTED_EVENT = "box-labels-printed-changed";

function subscribePrinted(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PRINTED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PRINTED_EVENT, onChange);
  };
}
function readPrinted(): string {
  try {
    return localStorage.getItem(PRINTED_KEY) ?? "";
  } catch {
    return "";
  }
}
function rememberPrinted(tokens: string[]) {
  try {
    const all = new Set(readPrinted().split(",").filter(Boolean));
    for (const t of tokens) all.add(t);
    localStorage.setItem(PRINTED_KEY, [...all].join(","));
    window.dispatchEvent(new Event(PRINTED_EVENT));
  } catch {
    /* storage unavailable: the badges just won't persist */
  }
}

const PER_PAGE = 5;

function Strip({ label }: { label: BoxLabel }) {
  return (
    // Black on white whatever the app theme is, so it scans anywhere.
    <div className="box-label flex items-center gap-[6mm] bg-white p-[4mm] text-black">
      <QRCodeCanvas
        value={boxQrData(label.token)}
        size={320}
        marginSize={1}
        bgColor="#ffffff"
        fgColor="#000000"
        style={{ width: "38mm", height: "38mm", flexShrink: 0 }}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[2mm]">
        <p className="box-label-title line-clamp-2 break-words font-bold leading-tight">{label.title}</p>
        <p className="box-label-path line-clamp-2 leading-snug text-neutral-700">{label.path}</p>
        <p className="box-label-code font-mono tracking-widest text-neutral-500">{label.token}</p>
      </div>
    </div>
  );
}

/**
 * A sheet of box stickers, five to a page: each one a wide strip with the QR
 * code at the left edge and, beside it, the box's name large enough to read
 * from arm's length, then where it lives, then the code in plain text (for the
 * day a sticker is scuffed and has to be typed in). One strip per row, with a
 * dashed outline, so the sheet is cut into strips and each strip glued onto a
 * container.
 *
 * You choose what prints: tick the boxes you need (a list of every box would
 * otherwise reprint the ones already stuck on). Labels this browser has printed
 * are marked, and "Select not yet printed" picks the rest. Opening a single
 * box's "Print label" (`only`) starts with that box ticked; the full list starts
 * with nothing ticked, so printing is always a choice.
 *
 * Only the ticked strips go to the printer, grouped five to a page here rather
 * than by CSS counting, so unticked ones never leave gaps. The strips are sized
 * in mm so the preview is what comes out; print rules are in globals.css.
 */
export function BoxLabelSheet({
  labels,
  backHref,
  startSelected = false,
}: {
  labels: BoxLabel[];
  backHref: string;
  /** Tick everything to begin with (a single box's own "Print label" link). */
  startSelected?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(startSelected ? labels.map((l) => l.id) : []));
  const [askPrinted, setAskPrinted] = useState(false);

  const printedRaw = useSyncExternalStore(subscribePrinted, readPrinted, () => "");
  const printed = useMemo(() => new Set(printedRaw.split(",").filter(Boolean)), [printedRaw]);

  const chosen = labels.filter((l) => selected.has(l.id));
  const pages: BoxLabel[][] = [];
  for (let i = 0; i < chosen.length; i += PER_PAGE) pages.push(chosen.slice(i, i + PER_PAGE));
  const notPrinted = labels.filter((l) => !printed.has(l.token));

  // After the print dialog closes, ask — it also closes on Cancel, so we cannot
  // know by ourselves whether anything came out.
  useEffect(() => {
    const onAfter = () => setAskPrinted(true);
    window.addEventListener("afterprint", onAfter);
    return () => window.removeEventListener("afterprint", onAfter);
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="box-label-sheet mx-auto max-w-5xl space-y-6">
      <div className="space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
            <h1 className="mt-2 font-serif text-[1.75rem] text-foreground">Box labels</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tick the labels to print — five to a page. Cut along the dashed lines. Scanning one opens the box and what
              is inside it.
            </p>
          </div>
          <Button type="button" onClick={() => window.print()} disabled={chosen.length === 0}>
            <Printer className="h-4 w-4" />
            Print {chosen.length > 0 ? `${chosen.length} label${chosen.length === 1 ? "" : "s"}` : ""}
          </Button>
        </div>

        {labels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="tabular-nums text-muted-foreground">
              {chosen.length} of {labels.length} selected
              {chosen.length > 0 ? ` · ${pages.length} page${pages.length === 1 ? "" : "s"}` : ""}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set(labels.map((l) => l.id)))}>
              Select all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={notPrinted.length === 0}
              onClick={() => setSelected(new Set(notPrinted.map((l) => l.id)))}
            >
              Select not yet printed ({notPrinted.length})
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={chosen.length === 0} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        ) : null}

        {askPrinted && chosen.length > 0 ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm">
            <span>Did those {chosen.length} label{chosen.length === 1 ? "" : "s"} print? Mark them so they are not printed again by mistake.</span>
            <span className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  rememberPrinted(chosen.map((l) => l.token));
                  setSelected(new Set());
                  setAskPrinted(false);
                }}
              >
                Yes, mark as printed
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setAskPrinted(false)}>
                No
              </Button>
            </span>
          </div>
        ) : null}
      </div>

      {labels.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground print:hidden">
          No boxes yet. Mark a location as a <strong>Box</strong> (edit it, set Type to Box) and it gets a label here.
        </p>
      ) : (
        <>
          {/* On screen: every box, tickable. Never printed. */}
          <ul className="mx-auto max-w-[190mm] space-y-3 print:hidden">
            {labels.map((l) => {
              const on = selected.has(l.id);
              const done = printed.has(l.token);
              return (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(l.id)}
                      className="h-5 w-5 flex-shrink-0 accent-[var(--highlight)]"
                      aria-label={`Print the label for ${l.title}`}
                    />
                    <span className={cn("min-w-0 flex-1 transition-opacity", on ? "" : "opacity-60")}>
                      <Strip label={l} />
                    </span>
                    {done ? (
                      <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        <Check className="h-3 w-3" /> Printed
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>

          {/* On paper: only the ticked ones, five to a page. */}
          <div className="hidden print:block">
            {pages.map((page, i) => (
              <div key={i} className="label-page">
                {page.map((l) => (
                  <Strip key={l.id} label={l} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

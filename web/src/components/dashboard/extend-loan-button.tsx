"use client";

import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extendLoan } from "@/app/(app)/items/[id]/actions";
import { returnByIso } from "@/lib/return-by";

/** "Change date": push a loan's return date. Shown to the holder and to managers. */
export function ExtendLoanButton({ itemId, takeId }: { itemId: string; takeId: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const when = returnByIso("custom", date);
    if (!when.iso) return setError(when.error ?? "Pick a date.");
    startTransition(async () => {
      const res = await extendLoan(itemId, takeId, when.iso!);
      if (res.error) return setError(res.error);
      setOpen(false);
      setDate("");
      setError(null);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Change date
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={date}
        min={new Date().toISOString().slice(0, 10)}
        onChange={(e) => { setDate(e.target.value); setError(null); }}
        className="h-8 w-40 text-xs"
        aria-label="New return date"
      />
      <Button type="button" size="sm" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <button type="button" onClick={() => { setOpen(false); setError(null); }} className="text-xs text-muted-foreground hover:text-foreground">
        Cancel
      </button>
      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

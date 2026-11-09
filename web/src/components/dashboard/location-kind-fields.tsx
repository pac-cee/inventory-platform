"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { KIND_LABELS, LOCATION_KINDS, type LocationKind } from "@/lib/location-kind";

/**
 * "What sort of place is this?" for the location forms, plus what a box is for.
 *
 * Submits `kind` and `label` with the form. The label is only asked for when the
 * place is a box — it is what the QR sticker on the box stands for ("USB-A to C
 * cables"). Plain native controls on purpose: they post with the form as-is.
 */
export function LocationKindFields({
  idPrefix,
  initialKind = "area",
  initialLabel = "",
  allowedKinds = LOCATION_KINDS,
}: {
  idPrefix: string;
  initialKind?: LocationKind;
  initialLabel?: string;
  /** What may be made here (Area > Shelf > Level > Box). One choice is shown as a fixed line, not a menu. */
  allowedKinds?: LocationKind[];
}) {
  const [kind, setKind] = useState<LocationKind>(allowedKinds.includes(initialKind) ? initialKind : allowedKinds[0] ?? initialKind);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-kind`} className="text-[13px] font-medium text-foreground">
          Type
        </label>
        {allowedKinds.length === 1 ? (
          <>
            <input type="hidden" name="kind" value={kind} />
            <p className="flex h-11 w-full items-center rounded-lg border border-input bg-muted/40 px-3 text-[13px] text-foreground">
              {KIND_LABELS[kind]}
            </p>
          </>
        ) : (
        <select
          id={`${idPrefix}-kind`}
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as LocationKind)}
          className="h-11 w-full rounded-lg border border-input bg-popover px-3 text-[13px] text-popover-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
        >
          {allowedKinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        )}
      </div>
      {kind === "box" ? (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-label`} className="text-[13px] font-medium text-foreground">
            What is this box for?
          </label>
          <Input
            id={`${idPrefix}-label`}
            name="label"
            defaultValue={initialLabel}
            maxLength={120}
            placeholder="e.g. USB-A to C cables"
          />
          <p className="text-xs text-muted-foreground">
            A box gets its own QR code. Scanning it opens this box and what is inside.
          </p>
        </div>
      ) : null}
    </div>
  );
}

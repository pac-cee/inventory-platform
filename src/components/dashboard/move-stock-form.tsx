"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Truck } from "lucide-react";
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
import { moveStockBetween } from "@/app/(app)/items/[id]/actions";
import type { Location, StockLevel } from "@/lib/api/types";
import { stockableLocations, locationLabel } from "@/lib/locations";

/**
 * Admin: move units of this item from one location to another — "5 from Lab A
 * to Ware House".
 *
 * This is the counterpart to "Edit stock numbers": moving never changes how
 * many units exist (the total travels with them), correcting does. Keeping the
 * two apart is what stops a relocation from quietly inflating or shrinking the
 * item's grand total, which is exactly how the double-counting started.
 *
 * Only units on the shelf can move. Damaged units and anything checked out stay
 * where they are — those belong to a person or a repair queue, not to whoever
 * is reorganising shelves.
 */
export function MoveStockForm({
  itemId,
  locations,
  stock,
  occupiedLocationIds = [],
}: {
  itemId: string;
  locations: Location[];
  stock: StockLevel[];
  occupiedLocationIds?: string[];
}) {
  const byId = new Map(locations.map((l) => [l.id, l]));

  // Sources: where this item actually sits, most first.
  const sources = stock
    .filter((s) => byId.has(s.location_id) && s.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);

  // Destinations: anywhere that can hold stock, including a room that keeps
  // items directly alongside its sub-locations.
  const destinations = stockableLocations(locations, occupiedLocationIds);

  const [fromId, setFromId] = useState(sources[0]?.location_id ?? "");
  const [toId, setToId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const available = sources.find((s) => s.location_id === fromId)?.quantity ?? 0;

  if (sources.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        Nothing is on the shelf anywhere, so there&apos;s nothing to move. Damaged units
        and items people are holding stay where they are.
      </p>
    );
  }

  function submit(all: boolean) {
    setError(null);
    setOk(null);
    const n = all ? undefined : quantity;
    startTransition(async () => {
      const res = await moveStockBetween(itemId, fromId, toId, n);
      if (res?.error) {
        setError(res.error);
        return;
      }
      const fromName = byId.get(fromId)?.name ?? "there";
      const toName = byId.get(toId)?.name ?? "there";
      setOk(all ? `Moved everything from ${fromName} to ${toName}.` : `Moved ${n} to ${toName}.`);
      setQuantity(1);
    });
  }

  return (
    <div className="space-y-4 p-5">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {ok ? <p className="text-sm text-success">{ok}</p> : null}

      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-2">
          <Label htmlFor="mv-from">From</Label>
          <Select
            value={fromId}
            onValueChange={(v) => {
              setFromId(v);
              setError(null);
            }}
          >
            <SelectTrigger id="mv-from" className="w-full">
              <SelectValue placeholder="Where it is now" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.location_id} value={s.location_id}>
                  {locationLabel(byId.get(s.location_id)!, locations)} · {s.quantity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ArrowRight className="mb-3 hidden h-4 w-4 text-muted-foreground sm:block" />

        <div className="space-y-2">
          <Label htmlFor="mv-to">To</Label>
          <Select
            value={toId}
            onValueChange={(v) => {
              setToId(v);
              setError(null);
            }}
          >
            <SelectTrigger id="mv-to" className="w-full">
              <SelectValue placeholder="Where it's going" />
            </SelectTrigger>
            <SelectContent>
              {destinations
                .filter((l) => l.id !== fromId)
                .map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {locationLabel(loc, locations)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2 sm:max-w-[12rem]">
        <Label htmlFor="mv-qty">How many</Label>
        <Input
          id="mv-qty"
          type="number"
          min={1}
          max={available || undefined}
          value={quantity}
          onChange={(e) => {
            setQuantity(Number(e.target.value));
            setError(null);
          }}
        />
        <p className="text-xs text-muted-foreground">{available} on the shelf there</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={pending || !fromId || !toId} onClick={() => submit(false)}>
          <Truck className="h-4 w-4" />
          {pending ? "Moving…" : "Move"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !fromId || !toId}
          onClick={() => submit(true)}
        >
          Move everything there
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Moving never changes how many units exist — the total travels with them. To
        actually add or remove units, use <strong>Edit stock numbers</strong>.{" "}
        <strong>Move everything there</strong> also takes damaged units and anything
        checked out, so returns land at the new location.
      </p>
    </div>
  );
}

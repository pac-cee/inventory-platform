"use client";

import { useEffect, useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
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
import { adjustStock } from "@/app/(app)/items/[id]/actions";
import type { StockLevel } from "@/lib/api/types";

/**
 * Admin-only: set the current quantity and the total (ceiling) for an item at a
 * location directly. Prefills with the chosen location's current numbers.
 */
export function StockAdjustForm({
  itemId,
  stock,
}: {
  itemId: string;
  stock: StockLevel[];
}) {
  const [locationId, setLocationId] = useState(stock[0]?.location_id ?? "");
  const current = stock.find((s) => s.location_id === locationId);
  const [quantity, setQuantity] = useState(current?.quantity ?? 0);
  const [capacity, setCapacity] = useState(current?.capacity ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // When the location changes, reset the inputs to that location's numbers.
  useEffect(() => {
    const row = stock.find((s) => s.location_id === locationId);
    setQuantity(row?.quantity ?? 0);
    setCapacity(row?.capacity ?? 0);
  }, [locationId, stock]);

  if (stock.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        This item isn&apos;t stored anywhere yet.
      </p>
    );
  }

  function submit() {
    setError(null);
    if (!locationId) return setError("Choose a location.");
    if (!Number.isFinite(quantity) || quantity < 0) return setError("Quantity can't be negative.");
    if (!Number.isFinite(capacity) || capacity < 0) return setError("Total can't be negative.");
    if (quantity > capacity) return setError("Quantity can't exceed the total.");
    startTransition(async () => {
      const res = await adjustStock(itemId, locationId, quantity, capacity);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-4 p-5">
      <div className="space-y-2">
        <Label htmlFor="adj-location">Location</Label>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger id="adj-location">
            <SelectValue placeholder="Choose a location" />
          </SelectTrigger>
          <SelectContent>
            {stock.map((s) => (
              <SelectItem key={s.location_id} value={s.location_id}>
                {s.locations?.name ?? s.location_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="adj-quantity">Current quantity</Label>
          <Input
            id="adj-quantity"
            type="number"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="adj-capacity">Total</Label>
          <Input
            id="adj-capacity"
            type="number"
            min={0}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="button" disabled={pending} onClick={submit}>
        <SlidersHorizontal className="h-4 w-4" />
        {pending ? "Saving…" : "Save stock numbers"}
      </Button>
    </div>
  );
}

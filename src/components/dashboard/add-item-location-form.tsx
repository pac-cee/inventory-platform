"use client";

import { useState, useTransition } from "react";
import { MapPin } from "lucide-react";
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
import { stockAtLocation } from "@/app/(app)/items/[id]/actions";
import type { Location, StockLevel } from "@/lib/api/types";
import { stockableLocations, locationLabel } from "@/lib/locations";

/**
 * Admin: register this existing item at another location (e.g. the same robot
 * arm lives both at work and at home) — no need to re-create the item. This is
 * the only way an item reaches a new location; everyone else can only move
 * stock where it is already registered.
 *
 * Offers every location that can hold stock — leaves, plus rooms that already
 * hold items directly alongside their sub-locations — minus the ones this item
 * is already in.
 */
export function AddItemLocationForm({
  itemId,
  locations,
  stock,
  occupiedLocationIds = [],
}: {
  itemId: string;
  locations: Location[];
  stock: StockLevel[];
  /** Locations that hold stock of ANY item — a parent room among them can take
   *  this one too, even though it isn't a leaf. */
  occupiedLocationIds?: string[];
}) {
  const stockedIds = new Set(stock.map((s) => s.location_id));
  const available = stockableLocations(locations, occupiedLocationIds).filter(
    (l) => !stockedIds.has(l.id),
  );

  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  if (available.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        This item is already stocked at every location.
      </p>
    );
  }

  function submit() {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await stockAtLocation(itemId, locationId, quantity);
      if (res?.error) {
        setError(res.error);
      } else {
        setOk(true);
        setLocationId("");
        setQuantity(1);
      }
    });
  }

  return (
    <div className="space-y-4 p-5">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {ok ? <p className="text-sm text-success">Added to location.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="add-loc">Location</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger id="add-loc" className="w-full">
              <SelectValue placeholder="Select a location…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {locationLabel(loc, locations)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="add-loc-qty">Starting quantity</Label>
          <Input
            id="add-loc-qty"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
      </div>
      <Button type="button" disabled={pending || !locationId} onClick={submit}>
        <MapPin className="h-4 w-4" />
        {pending ? "Adding…" : "Add to location"}
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cancelReservation, reserveItem } from "@/app/(app)/items/[id]/actions";
import type { Holder, Location, Reservation, StockLevel } from "@/lib/api/types";
import { locationLabel } from "@/lib/locations";
import { stateLabel, windowFromDates, windowLabel } from "@/lib/reserve-window";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Reserve this item: hold some units at a place for a few days so they are there
 * when you come. Shows what is already reserved, with a Cancel for your own (or
 * anyone's, for a manager). Managers can also reserve for someone else.
 */
export function ReservationsPanel({
  itemId,
  locations,
  stock,
  reservations,
  currentUserId,
  isManager,
  behalfPeople = [],
}: {
  itemId: string;
  locations: Location[];
  stock: StockLevel[];
  reservations: Reservation[];
  currentUserId: string;
  isManager: boolean;
  behalfPeople?: Holder[];
}) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const places = stock
    .filter((s) => byId.has(s.location_id) && s.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity)
    .map((s) => ({ loc: byId.get(s.location_id)!, quantity: s.quantity }));

  const today = ymd(new Date());
  const [locationId, setLocationId] = useState(places[0]?.loc.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [forPerson, setForPerson] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!locationId) return setError("Choose where to reserve it.");
    if (!Number.isFinite(quantity) || quantity < 1) return setError("Enter a quantity of at least 1.");
    const w = windowFromDates(from, to);
    if (w.error) return setError(w.error);
    startTransition(async () => {
      const res = await reserveItem(itemId, {
        locationId,
        quantity,
        startsAt: w.starts_at!,
        endsAt: w.ends_at!,
        note: note.trim() || undefined,
        forUserId: forPerson || undefined,
      });
      if (res.error) return setError(res.error);
      setNote("");
    });
  }

  function cancel(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await cancelReservation(itemId, id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-4 p-5">
      {reservations.length > 0 ? (
        <ul className="space-y-2">
          {reservations.map((r) => {
            const st = stateLabel(r.state);
            const mine = r.user_id === currentUserId;
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{r.quantity}</span>
                  <span className="text-muted-foreground"> · {r.location_name} · {windowLabel(r)}</span>
                  {!mine ? <span className="block text-xs text-muted-foreground">for {r.user_name || "someone"}</span> : null}
                  {r.requested_by !== r.user_id ? (
                    <span className="block text-xs text-muted-foreground">booked by {r.requested_by_name || "a manager"}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className={
                      st.tone === "good"
                        ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
                        : st.tone === "warn"
                          ? "text-xs font-medium text-amber-600 dark:text-amber-400"
                          : "text-xs text-muted-foreground"
                    }
                  >
                    {st.text}
                  </span>
                  {(mine || isManager || r.requested_by === currentUserId) && (r.state === "upcoming" || r.state === "active") ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => cancel(r.id)}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing reserved for this item right now.</p>
      )}

      {places.length === 0 ? (
        <p className="text-sm text-muted-foreground">There is none on a shelf to reserve right now.</p>
      ) : (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rs-location">Where</Label>
              <Select value={locationId} onValueChange={(v) => { setLocationId(v); setError(null); }}>
                <SelectTrigger id="rs-location">
                  <SelectValue placeholder="Choose a location" />
                </SelectTrigger>
                <SelectContent>
                  {places.map(({ loc, quantity: q }) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {locationLabel(loc, locations)} · {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-quantity">Quantity</Label>
              <Input id="rs-quantity" type="number" min={1} value={quantity} onChange={(e) => { setQuantity(Number(e.target.value)); setError(null); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-from">From</Label>
              <Input id="rs-from" type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); setError(null); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rs-to">Until (end of day)</Label>
              <Input id="rs-to" type="date" min={from} value={to} onChange={(e) => { setTo(e.target.value); setError(null); }} />
            </div>
          </div>

          {isManager && behalfPeople.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="rs-for">Reserve for</Label>
              <Select value={forPerson || "me"} onValueChange={(v) => setForPerson(v === "me" ? "" : v)}>
                <SelectTrigger id="rs-for">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">Me</SelectItem>
                  {behalfPeople.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name || "Unknown"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="rs-note">Note (optional)</Label>
            <Input id="rs-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for the demo on Friday" />
          </div>

          <p className="text-xs text-muted-foreground">
            Reserved units are held for you from the first day: nobody else can take them. Taking them yourself collects the reservation.
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="button" onClick={submit} disabled={pending}>
            <CalendarCheck className="h-4 w-4" />
            {pending ? "Reserving…" : "Reserve"}
          </Button>
        </div>
      )}
      {places.length === 0 && error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

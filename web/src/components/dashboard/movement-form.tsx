"use client";

import { useState, useTransition } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Trash2, Wrench, PackageX } from "lucide-react";
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
import { recordMovement, listFaults, type StockAction } from "@/app/(app)/items/[id]/actions";
import type { Location, Holder, StockLevel, Fault } from "@/lib/api/types";
import { locationLabel } from "@/lib/locations";
import { RETURN_BY_OPTIONS, returnByIso, type ReturnBy } from "@/lib/return-by";

/** Actions that need more than a quantity before they can be recorded. */
const NEEDS_DETAIL: StockAction[] = ["destroy", "lost", "repair"];

const DETAIL_COPY: Record<string, { title: string; verb: string }> = {
  destroy: { title: "Mark damaged", verb: "Mark damaged" },
  lost: { title: "Mark lost", verb: "Mark lost" },
  repair: { title: "Record a repair", verb: "Record repair" },
};

export function MovementForm({
  itemId,
  locations,
  stock,
  finishable = false,
  isAdmin = false,
  holders = [],
  behalfPeople = [],
  defaultLocationId,
}: {
  itemId: string;
  locations: Location[];
  stock: StockLevel[];
  finishable?: boolean;
  isAdmin?: boolean;
  holders?: Holder[];
  /** Managers: people a take/return can be recorded for. Empty = the option is hidden. */
  behalfPeople?: Holder[];
  /** Where to start (e.g. the box the person just scanned); falls back to wherever most is. */
  defaultLocationId?: string;
}) {
  // Only where THIS item is registered. Taking or returning somewhere it was
  // never stocked isn't a real operation — an admin registers it there first
  // via "Add to another location", which is also the server-side rule. Note
  // this deliberately includes a parent room that holds the item directly:
  // those are not leaves, so a leaf-only list used to hide them.
  const byId = new Map(locations.map((l) => [l.id, l]));
  const places = stock
    .filter((s) => byId.has(s.location_id))
    .sort((a, b) => b.quantity - a.quantity || (b.capacity ?? 0) - (a.capacity ?? 0))
    .map((s) => ({ loc: byId.get(s.location_id)!, quantity: s.quantity }));

  // Default to wherever most of it is — usually the one you mean.
  const [locationId, setLocationId] = useState(
    places.find((p) => p.loc.id === defaultLocationId)?.loc.id ?? places[0]?.loc.id ?? "",
  );
  const [quantity, setQuantity] = useState(1);
  const [damagedBy, setDamagedBy] = useState("");
  // How long the person will use it — sent with a Take so the app knows when it is due back.
  const [returnBy, setReturnBy] = useState<ReturnBy>("none");
  const [returnDate, setReturnDate] = useState("");
  // Managers can record a take/return for someone else ("" = for myself).
  const [forPerson, setForPerson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Damage, loss and repair open a second step instead of firing immediately —
  // the condition report is a tally of WHY things are damaged, so a reason has
  // to be captured at the moment someone knows it.
  const [detailFor, setDetailFor] = useState<StockAction | null>(null);
  const [note, setNote] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [faults, setFaults] = useState<Fault[] | null>(null);
  const [resolves, setResolves] = useState("");

  if (places.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        {isAdmin
          ? "This item isn't stocked anywhere yet — add it to a location below first."
          : "This item isn't stocked at any location yet. Ask an admin to add it to one."}
      </p>
    );
  }

  function resetDetail() {
    setDetailFor(null);
    setNote("");
    setRecommendation("");
    setResolves("");
    setFaults(null);
  }

  /** Validate the shared fields; returns false and shows why if they're wrong. */
  function fieldsOk(): boolean {
    setError(null);
    if (!locationId) {
      setError("Choose a location.");
      return false;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Enter a quantity of at least 1.");
      return false;
    }
    return true;
  }

  function start(action: StockAction) {
    if (!fieldsOk()) return;
    if (!NEEDS_DETAIL.includes(action)) return submit(action);

    setDetailFor(action);
    setNote("");
    setRecommendation("");
    setResolves("");
    if (action === "repair") {
      // Offer the recorded faults so the repair clears a specific one.
      setFaults(null);
      startTransition(async () => {
        const res = await listFaults(itemId, locationId);
        if (res.error) setError(res.error);
        setFaults(res.faults ?? []);
      });
    }
  }

  function submit(action: StockAction) {
    if (!fieldsOk()) return;
    if ((action === "destroy" || action === "lost") && note.trim().length < 3) {
      return setError("Say what is wrong with them — the condition report prints this.");
    }
    let expectedReturnAt: string | undefined;
    if (action === "take") {
      const when = returnByIso(returnBy, returnDate);
      if (when.error) return setError(when.error);
      expectedReturnAt = when.iso ?? undefined;
    }
    startTransition(async () => {
      const res = await recordMovement(itemId, locationId, quantity, action, {
        expectedReturnAt,
        onBehalfOf: (action === "take" || action === "return") && forPerson ? forPerson : undefined,
        damagedBy: (action === "destroy" || action === "lost") && damagedBy ? damagedBy : undefined,
        note: note.trim() || undefined,
        recommendation: recommendation.trim() || undefined,
        resolves: action === "repair" && resolves ? resolves : undefined,
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      resetDetail();
    });
  }

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mv-location">Location</Label>
          <Select value={locationId} onValueChange={(v) => { setLocationId(v); setError(null); }}>
            <SelectTrigger id="mv-location">
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
          <Label htmlFor="mv-quantity">Quantity</Label>
          <Input
            id="mv-quantity"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => { setQuantity(Number(e.target.value)); setError(null); }}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mv-return-by">Return by (when you press Take)</Label>
          <Select value={returnBy} onValueChange={(v) => { setReturnBy(v as ReturnBy); setError(null); }}>
            <SelectTrigger id="mv-return-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETURN_BY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {returnBy === "custom" ? (
          <div className="space-y-2">
            <Label htmlFor="mv-return-date">Date</Label>
            <Input
              id="mv-return-date"
              type="date"
              value={returnDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => { setReturnDate(e.target.value); setError(null); }}
            />
          </div>
        ) : null}
      </div>

      {isAdmin && behalfPeople.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="mv-for-person">Record for</Label>
          <Select value={forPerson || "me"} onValueChange={(v) => { setForPerson(v === "me" ? "" : v); setError(null); }}>
            <SelectTrigger id="mv-for-person">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="me">Me</SelectItem>
              {behalfPeople.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  {p.full_name || "Unknown"}
                  {p.quantity > 0 ? ` · holds ${p.quantity}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            For someone who cannot do it themselves. <strong>Take</strong> and <strong>Return</strong> are recorded
            under their name, marked as recorded by you. For a return, pick someone who holds this item.
          </p>
        </div>
      ) : null}

      {isAdmin && holders.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="mv-damaged-by">Damaged / lost by</Label>
          <Select value={damagedBy || "shelf"} onValueChange={(v) => setDamagedBy(v === "shelf" ? "" : v)}>
            <SelectTrigger id="mv-damaged-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shelf">On the shelf</SelectItem>
              {holders.map((h) => (
                <SelectItem key={h.user_id} value={h.user_id}>
                  {h.full_name || "Unknown"}
                  {h.quantity > 0 ? ` · holds ${h.quantity}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Applies to <strong>Damaged</strong> / <strong>Lost</strong> — attribute it to whoever damaged or lost it (it comes out of their checked-out count).
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {detailFor ? (
        <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            {DETAIL_COPY[detailFor].title} · {quantity}
          </p>

          {detailFor === "repair" ? (
            <div className="space-y-2">
              <Label htmlFor="mv-resolves">What did you fix?</Label>
              {faults === null ? (
                <p className="text-xs text-muted-foreground">Loading recorded faults…</p>
              ) : faults.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing damaged here has a recorded reason, so there is no fault to clear. The
                  repair still returns the units to use.
                </p>
              ) : (
                <>
                  <Select value={resolves} onValueChange={setResolves}>
                    <SelectTrigger id="mv-resolves">
                      <SelectValue placeholder="Choose the fault you fixed" />
                    </SelectTrigger>
                    <SelectContent>
                      {faults.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.note} · {f.units}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Picking the fault removes it from the condition report once every unit it
                    affected is fixed.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="mv-note">
                  What&apos;s wrong? <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="mv-note"
                  value={note}
                  placeholder="batteries died"
                  onChange={(e) => {
                    setNote(e.target.value);
                    setError(null);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  This is what the condition report prints, word for word.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mv-recommendation">What should be done?</Label>
                <Input
                  id="mv-recommendation"
                  value={recommendation}
                  placeholder="Replace those batteries"
                  onChange={(e) => setRecommendation(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Shows in the report&apos;s Recommendation column, and retires when the
                  fault is repaired.
                </p>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={pending} onClick={() => submit(detailFor)}>
              {pending ? "Working…" : DETAIL_COPY[detailFor].verb}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={resetDetail}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={pending} onClick={() => start("take")}>
          <ArrowUpFromLine className="h-4 w-4" />
          {pending ? "Working…" : "Take from stock"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => start("return")}
        >
          <ArrowDownToLine className="h-4 w-4" />
          Return to stock
        </Button>
        {finishable ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => start("finish")}
          >
            <CheckCircle2 className="h-4 w-4" />
            Finish
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => start("destroy")}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          Damaged
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => start("lost")}
          className="text-destructive hover:text-destructive"
        >
          <PackageX className="h-4 w-4" />
          Lost
        </Button>
        {isAdmin ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => start("repair")}>
            <Wrench className="h-4 w-4" />
            Repair
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Take/return move stock as usual. <strong>Damaged</strong> marks units as
        damaged — they stay part of the total but aren&apos;t accessible; <strong>Repair</strong>
        moves them back. <strong>Finish</strong> permanently consumes stock (reduces the total).
        Damaged/finished entries can be undone from the activity log.
      </p>
    </div>
  );
}

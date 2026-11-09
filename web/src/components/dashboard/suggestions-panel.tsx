"use client";

import { useActionState, useState, useTransition } from "react";
import { Lightbulb, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addSuggestion,
  resolveSuggestion,
  removeSuggestion,
  type SuggestionState,
} from "@/app/(app)/items/[id]/suggestion-actions";
import type { Location, Suggestion } from "@/lib/api/types";

// Radix Select rejects an empty string as a value, so "anywhere" needs a
// sentinel. Same convention as the report filters.
const ANYWHERE = "__anywhere__";

const KINDS = [
  { value: "upgrade", label: "Upgrade" },
  { value: "replace", label: "Replace" },
  { value: "maintenance", label: "Maintenance" },
  { value: "other", label: "Other" },
];

function kindLabel(kind: string): string {
  return KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/**
 * Suggested changes for an item that still works.
 *
 * Deliberately separate from marking stock damaged: nothing here changes a
 * count. Anyone can raise one — the people using the equipment know what it
 * needs — and only an admin closes one.
 */
export function SuggestionsPanel({
  itemId,
  suggestions,
  locations,
  isAdmin,
  currentUserId,
}: {
  itemId: string;
  suggestions: Suggestion[];
  /** Places this item is stocked, so a suggestion can be scoped to one. */
  locations: Location[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  const action = addSuggestion.bind(null, itemId);
  const [state, formAction, pending] = useActionState<SuggestionState, FormData>(action, {});
  const [kind, setKind] = useState("upgrade");
  const [locationId, setLocationId] = useState(ANYWHERE);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close(id: string) {
    const resolution = window.prompt("What was done? (optional)") ?? "";
    startTransition(async () => {
      const res = await resolveSuggestion(itemId, id, resolution);
      if (res.error) setError(res.error);
    });
  }

  function withdraw(id: string) {
    startTransition(async () => {
      const res = await removeSuggestion(itemId, id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-4 p-5">
      {suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing suggested. Use this for work worth doing on something that still
          works — an upgrade or a service — rather than damage.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {suggestions.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm text-fg">{s.note}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {kindLabel(s.kind)}
                  {s.units ? ` · ${s.units} unit${s.units === 1 ? "" : "s"}` : ""}
                  {s.location_name ? ` · ${s.location_name}` : " · anywhere"}
                  {s.created_by_name ? ` · ${s.created_by_name}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => close(s.id)}
                    title="Mark as done"
                  >
                    <Check className="size-4" aria-hidden />
                  </Button>
                ) : null}
                {isAdmin || s.created_by === currentUserId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => withdraw(s.id)}
                    title="Withdraw"
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {state.error ? (
        <Alert variant="error">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok ? (
        <Alert variant="success">
          <AlertDescription>Suggestion added.</AlertDescription>
        </Alert>
      ) : null}

      <form action={formAction} className="space-y-3 border-t border-line pt-4">
        <div className="space-y-2">
          <Label htmlFor="sug-note">Suggest a change</Label>
          <Input
            id="sug-note"
            name="note"
            required
            placeholder="e.g. Upgrade to 16GB RAM"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="sug-kind">Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="sug-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="kind" value={kind} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sug-location">Where</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger id="sug-location" className="w-full">
                <SelectValue placeholder="Anywhere" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANYWHERE}>Anywhere</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* The sentinel never leaves the form — blank means anywhere. */}
            <input
              type="hidden"
              name="location_id"
              value={locationId === ANYWHERE ? "" : locationId}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sug-units">Units</Label>
            <Input id="sug-units" name="units" type="number" min={1} placeholder="All" />
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          <Lightbulb className="size-4" aria-hidden />
          {pending ? "Adding…" : "Add suggestion"}
        </Button>
      </form>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhotoField } from "@/components/dashboard/photo-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addItem, type AddItemState } from "@/app/(app)/admin/actions";
import type { Location } from "@/lib/api/types";

/**
 * Add an item. Identified by type + name + model; the free-text specification
 * adds detail. The SKU is not asked for — the server assigns it from the type
 * (vrlt-cbl-001 for the first Cable). The location is picked with a cascade that
 * keeps revealing the next sub-location level until you reach a leaf (works at
 * any nesting depth).
 */
export function AddItemForm({
  locations,
  categories = [],
  onAdded,
}: {
  locations: Location[];
  /** Called once an item is saved — lets a dialog close itself. */
  onAdded?: () => void;
  /** Categories already in use, offered as suggestions so free text doesn't
   *  drift and split the condition report's grouping. */
  categories?: string[];
}) {
  const [state, formAction, pending] = useActionState<AddItemState, FormData>(addItem, {});
  const formRef = useRef<HTMLFormElement>(null);

  const topLevel = useMemo(() => locations.filter((l) => !l.parent_id), [locations]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, Location[]>();
    for (const l of locations) {
      if (l.parent_id) {
        const arr = map.get(l.parent_id) ?? [];
        arr.push(l);
        map.set(l.parent_id, arr);
      }
    }
    return map;
  }, [locations]);

  const noLocations = topLevel.length === 0;
  // The chain of chosen locations, root -> deepest.
  const [path, setPath] = useState<string[]>([]);
  // How this item's stock is counted:
  //  - "units":     loose individual units
  //  - "container": units packed in containers, tracked as units (shows "N units")
  //  - "package":   whole packages, contents NOT tracked (shows "5 packages")
  const [mode, setMode] = useState<"units" | "container" | "package">("units");
  // form.reset() is a DOM reset and cannot clear the photo field's React
  // state, so it is remounted instead — otherwise the last item's picture
  // stays selected for the next one.
  const [photoKey, setPhotoKey] = useState(0);

  // One dropdown per level: level 0 = top-level; each deeper level lists the
  // children of the location chosen above it, until a leaf is reached.
  const levels: { options: Location[]; selected: string }[] = [];
  {
    let options = topLevel;
    for (let i = 0; ; i++) {
      levels.push({ options, selected: path[i] ?? "" });
      const sel = path[i];
      if (!sel) break;
      const kids = childrenOf.get(sel) ?? [];
      if (kids.length === 0) break; // reached a leaf
      options = kids;
    }
  }
  const last = path[path.length - 1] ?? "";
  const lastHasChildren = last ? (childrenOf.get(last)?.length ?? 0) > 0 : false;
  // Items live in a leaf location — only a fully-drilled selection is valid.
  const effectiveLocationId = last && !lastHasChildren ? last : "";

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setPath([]);
      setMode("units");
      setPhotoKey((k) => k + 1);
      onAdded?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new result should fire this
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 p-5">
      {state.error ? (
        <Alert variant="error">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok ? (
        <Alert variant="success">
          <AlertDescription>Item added.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="type">Item type</Label>
          <Input id="type" name="type" required placeholder="Cable" />
          <p className="text-xs text-muted-foreground">
            The kind of thing this is. The SKU is built from it.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required placeholder="Patch Lead 3m" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" required placeholder="CAT6-3M" />
        </div>
        <div className="space-y-2">
          <Label>SKU</Label>
          {/* Read-only stand-in: the real value is assigned on save. */}
          <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
            Assigned automatically
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="specification">Specification</Label>
        <Input
          id="specification"
          name="specification"
          placeholder="e.g. HP · 16GB RAM · 512GB SSD"
        />
        <p className="text-xs text-muted-foreground">
          Two items may share a name as long as the type or the model differs — that is how variants are told apart.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        {/* Free text with suggestions: filing a new kind of thing shouldn't
            need a settings screen first. */}
        <Input
          id="category"
          name="category"
          list="add-category-options"
          placeholder="e.g. Computer Laptop, Cables"
        />
        <datalist id="add-category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Groups this item on the condition report.
        </p>
      </div>

      <PhotoField key={photoKey} idPrefix="add" />

      <label htmlFor="finishable" className="flex items-center gap-2 text-sm text-fg">
        <input
          id="finishable"
          name="finishable"
          type="checkbox"
          className="h-4 w-4 rounded border-border accent-highlight"
        />
        Finishable — users can permanently use this item up
      </label>

      {/* The effective leaf location id is submitted. */}
      <input type="hidden" name="location_id" value={effectiveLocationId} />

      <div className="grid gap-4 sm:grid-cols-2">
        {levels.map((lvl, i) => (
          <div key={i} className="space-y-2">
            <Label htmlFor={`location_${i}`}>{i === 0 ? "Location" : "Sub-location"}</Label>
            <Select
              value={lvl.selected}
              onValueChange={(v) => setPath([...path.slice(0, i), v])}
              disabled={noLocations}
            >
              <SelectTrigger id={`location_${i}`} className="w-full">
                <SelectValue placeholder={i === 0 ? "Select a location…" : "Select a sub-location…"} />
              </SelectTrigger>
              <SelectContent>
                {lvl.options.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="count-mode">Counted as</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger id="count-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="units">Individual units</SelectItem>
              <SelectItem value="container">Containers (track units inside)</SelectItem>
              <SelectItem value="package">Packages (don&apos;t count contents)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quantity">
            {mode === "container" ? "Starting quantity (containers)" : mode === "package" ? "Number of packages" : "Starting quantity"}
          </Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            defaultValue={1}
            required
            disabled={noLocations}
          />
        </div>
        {mode === "container" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="units_per_container">Units per container</Label>
              <Input id="units_per_container" name="units_per_container" type="number" min={1} defaultValue={1} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="container_label">Container label</Label>
              <Input id="container_label" name="container_label" placeholder="e.g. box, pallet" />
            </div>
          </>
        ) : null}
        {mode === "package" ? (
          <div className="space-y-2">
            <Label htmlFor="package_label">Package label</Label>
            <Input id="package_label" name="package_label" placeholder="e.g. package, crate, reel" defaultValue="package" />
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {lastHasChildren
          ? "That location has sub-locations — keep drilling down to a specific one."
          : "Every item must be assigned to a location with a starting quantity."}
      </p>

      {noLocations ? (
        <Alert variant="warning">
          <AlertDescription>
            No locations exist yet. Create one on the{" "}
            <Link href="/locations" className="font-medium underline">
              Locations
            </Link>{" "}
            page before adding items.
          </AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending || noLocations || !effectiveLocationId}>
        <Plus className="h-4 w-4" />
        {pending ? "Adding…" : "Add item"}
      </Button>
    </form>
  );
}

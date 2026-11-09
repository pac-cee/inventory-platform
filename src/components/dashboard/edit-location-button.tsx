"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhotoField } from "@/components/dashboard/photo-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { editLocation, type EditLocationState } from "@/app/(app)/admin/actions";
import type { Location } from "@/lib/api/types";
import { LocationKindFields } from "@/components/dashboard/location-kind-fields";
import { kindsForEdit } from "@/lib/location-kind";

/** Per-location admin action: rename a location or sub-location. */
export function EditLocationButton({ location, parentKind = null }: { location: Location; parentKind?: string | null }) {
  const id = location.id;
  const kind = location.parent_id ? "sub-location" : "location";
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<EditLocationState, FormData>(
    editLocation.bind(null, id),
    {},
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${location.name}`}
        title={`Edit ${kind}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
      >
        <Pencil className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {kind}</DialogTitle>
          </DialogHeader>

          <form action={formAction} className="mt-4 space-y-4">
            {state.error ? (
              <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor={`edit-loc-name-${id}`}>Name</Label>
              <Input
                id={`edit-loc-name-${id}`}
                name="name"
                defaultValue={location.name}
                required
                placeholder="e.g. Warehouse A"
              />
            </div>

            <LocationKindFields
              idPrefix={`edit-loc-${id}`}
              initialKind={location.kind ?? "area"}
              allowedKinds={kindsForEdit(location.kind ?? "area", parentKind)}
              initialLabel={location.label ?? ""}
            />

            <PhotoField
              idPrefix={`edit-loc-${id}`}
              initialUrl={location.photo_url ?? null}
              initialHasPhoto={location.has_photo ?? false}
            />

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                <Save className="h-4 w-4" />
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

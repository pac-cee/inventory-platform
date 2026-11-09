"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhotoField } from "@/components/dashboard/photo-field";
import { addLocation, type AddLocationState } from "@/app/(app)/admin/actions";
import { LocationKindFields } from "@/components/dashboard/location-kind-fields";
import { kindsAllowedUnder } from "@/lib/location-kind";

/**
 * Add a sub-location under `parentId`. The parent is implied by context (you're
 * on that location's page), so there's no dropdown — you just type the name.
 */
export function AddSubLocationForm({ parentId, parentKind }: { parentId: string; parentKind: string }) {
  const allowedKinds = kindsAllowedUnder(parentKind);
  const [state, formAction, pending] = useActionState<AddLocationState, FormData>(
    addLocation,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  // The picker holds its file and link in its own state, which reset() misses.
  const [photoKey, setPhotoKey] = useState(0);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setPhotoKey((k) => k + 1);
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="parent_id" value={parentId} />
      <Input name="name" required placeholder={`New ${allowedKinds[0] ?? "place"} (e.g. ${allowedKinds[0] === "level" ? "Level 2" : allowedKinds[0] === "box" ? "Box 12" : "Shelf 3"})`} />
      <LocationKindFields key={`k-${photoKey}`} idPrefix={`add-sub-${parentId}`} allowedKinds={allowedKinds} />
      <PhotoField key={photoKey} idPrefix={`add-sub-${parentId}`} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Plus className="h-4 w-4" />
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}

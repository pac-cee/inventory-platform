"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhotoField } from "@/components/dashboard/photo-field";
import { addLocation, type AddLocationState } from "@/app/(app)/admin/actions";
import { LocationKindFields } from "@/components/dashboard/location-kind-fields";
import { useFormDialogClose } from "@/components/ui/form-dialog";
import { kindsAllowedUnder } from "@/lib/location-kind";

/** Create a top-level location. Sub-locations are added from a location's page. */
export function AddLocationForm() {
  // Set when the form sits in a dialog: it closes itself once saved.
  const closeDialog = useFormDialogClose();
  const [state, formAction, pending] = useActionState<AddLocationState, FormData>(
    addLocation,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  // Remounting the picker is what actually empties it — its file and link live
  // in its own state, which form.reset() does not touch.
  const [photoKey, setPhotoKey] = useState(0);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setPhotoKey((k) => k + 1);
      closeDialog?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new result should fire this
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <Input name="name" required placeholder="New location (e.g. Warehouse A)" />
      <LocationKindFields key={`k-${photoKey}`} idPrefix="add-loc" allowedKinds={kindsAllowedUnder(null)} />
      <PhotoField key={photoKey} idPrefix="add-loc" />
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

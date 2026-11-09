"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { removeLocation } from "@/app/(app)/admin/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function RemoveLocationButton({
  id,
  name,
  redirectTo,
}: {
  id: string;
  name: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      // The action returns the outcome rather than throwing: a thrown server
      // action is redacted in production, which is what made this fail silently.
      // The error is shown inside the dialog, so a refusal ("not empty") is read
      // before the dialog is dismissed.
      const res = await removeLocation(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove location “${name}”?`}
        description="It has to be empty and have no sub-locations. Anything that happened here stays in the activity report."
        confirmLabel="Remove location"
        pending={pending}
        error={error}
        onConfirm={onConfirm}
      />
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { removeItem } from "@/app/(app)/admin/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function RemoveItemButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await removeItem(id);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove item.");
      }
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
        // 40px hit area; the icon stays small.
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove “${name}”?`}
        description="It is taken out of the catalog. This can't be undone."
        confirmLabel="Remove item"
        pending={pending}
        error={error}
        onConfirm={onConfirm}
      />
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteUser } from "@/app/(app)/admin/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteUserButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteUser(id);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete user.");
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
        aria-label={`Delete ${name}`}
        title={`Delete ${name}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${name}'s account?`}
        description="This permanently removes the user. It can't be undone."
        confirmLabel="Delete user"
        pending={pending}
        error={error}
        onConfirm={onConfirm}
      />
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { undoMovement } from "@/app/(app)/items/[id]/actions";

/** Undo button shown on finish/destroyed activity rows. */
export function UndoMovementButton({
  movementId,
  itemId,
}: {
  movementId: string;
  itemId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function undo() {
    setError(null);
    startTransition(async () => {
      const res = await undoMovement(movementId, itemId);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={undo}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-fg disabled:opacity-50"
      >
        <Undo2 className="h-3.5 w-3.5" />
        {pending ? "Undoing…" : "Undo"}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

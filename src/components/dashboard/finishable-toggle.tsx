"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setFinishable } from "@/app/(app)/items/[id]/actions";

/**
 * Admin-only toggle controlling whether an item can be "finished" (consumed).
 * Optimistically flips, reverts on error.
 */
export function FinishableToggle({
  itemId,
  finishable,
}: {
  itemId: string;
  finishable: boolean;
}) {
  const [on, setOn] = useState(finishable);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setError(null);
    startTransition(async () => {
      const res = await setFinishable(itemId, next);
      if (res?.error) {
        setOn(!next);
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex items-center justify-between px-5 py-5">
      <div>
        <p className="text-sm font-medium text-fg">Finishable</p>
        <p className="text-sm text-muted-foreground">
          When on, anyone can permanently finish (use up) this item.
        </p>
        {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
      </div>
      <Button type="button" variant={on ? "default" : "outline"} disabled={pending} onClick={toggle}>
        {on ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        {on ? "On" : "Off"}
      </Button>
    </div>
  );
}

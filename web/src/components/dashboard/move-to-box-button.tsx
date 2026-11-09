"use client";

import { useState, useTransition } from "react";
import { PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { moveStockBetween } from "@/app/(app)/items/[id]/actions";

export interface BoxChoice {
  id: string;
  /** What the box is for, or its name. */
  label: string;
}

/**
 * On a level's page, next to an item: put some (or all) of it into one of the boxes on
 * this level. Boxes are where the items really live, so this is how a level's loose stock
 * gets split into them — "19 of these: 10 into Box 1, 9 into Box 2".
 * Native controls on purpose: they are plain, fast and work with the keyboard.
 */
export function MoveToBoxButton({
  itemId,
  itemName,
  fromLocationId,
  available,
  boxes,
}: {
  itemId: string;
  itemName: string;
  fromLocationId: string;
  available: number;
  boxes: BoxChoice[];
}) {
  const [open, setOpen] = useState(false);
  const [boxId, setBoxId] = useState(boxes[0]?.id ?? "");
  const [quantity, setQuantity] = useState(String(available));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const n = Number(quantity);
  const valid = Number.isInteger(n) && n >= 1 && n <= available && boxId !== "";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await moveStockBetween(itemId, fromLocationId, boxId, n);
      if (res.error) setError(res.error);
      else setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQuantity(String(available));
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`Move ${itemName} into a box`}>
          <PackageOpen className="h-4 w-4" /> Move to box
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move into a box</DialogTitle>
          <DialogDescription>
            {itemName} · {available} on this level
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`box-${itemId}`}>Box</Label>
            <select
              id={`box-${itemId}`}
              value={boxId}
              onChange={(e) => setBoxId(e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-popover px-3 text-[13px] text-popover-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-highlight"
            >
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`qty-${itemId}`}>How many</Label>
            <Input
              id={`qty-${itemId}`}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <p className="text-xs text-muted-foreground">Up to {available}. The rest stays on the level.</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={!valid || pending}>
              {pending ? "Moving…" : "Move"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

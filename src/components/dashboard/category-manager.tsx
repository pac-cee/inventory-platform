"use client";

import { useState, useTransition } from "react";
import { Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { retireCategory } from "@/app/(app)/admin/actions";

export interface CategoryUsage {
  category: string;
  items: number;
}

/**
 * "Manage categories": the categories in use, each with an × to retire it.
 * Filtering lives in the chips above the catalog; this is only for removal.
 *
 * There is no categories table — a category exists only because items carry the
 * text — so retiring one clears it off those items. That is a bulk edit, which
 * is why the count is shown up front and the confirmation names it.
 *
 * Matching is exact, so "Cables" and "cables" appear separately and a mistyped
 * one can be retired without touching the real one. That is the point of the
 * list, so it is worth saying on screen.
 */
export function CategoryManager({ categories }: { categories: CategoryUsage[] }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<CategoryUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    if (!target) return;
    setError(null);
    startTransition(async () => {
      try {
        await retireCategory(target.category);
        setTarget(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove that category.");
      }
    });
  }

  const plural = (n: number) => (n === 1 ? "1 item" : `${n} items`);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Settings2 /> Manage categories
          </Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5 pr-12">
            <DialogTitle>Manage categories</DialogTitle>
            <DialogDescription>
              Removing a category clears it from its items — the items themselves are kept. Names are
              matched exactly, so a mistyped “cables” can be removed without touching “Cables”.
            </DialogDescription>
          </DialogHeader>
          {categories.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No categories yet. They appear here as soon as an item is given one.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-y-auto">
              {categories.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3 py-1 pl-6 pr-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.category}</span>
                  <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">{plural(c.items)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setTarget(c);
                    }}
                    aria-label={`Remove category ${c.category}`}
                    title={`Remove “${c.category}”`}
                    // 40px hit area; the icon stays small.
                    className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title={target ? `Remove the category “${target.category}”?` : "Remove category"}
        description={
          target ? (
            <>
              It is cleared from {plural(target.items)}. The items stay; only their category is
              removed, and it stops appearing in the pickers and the condition report.
            </>
          ) : null
        }
        confirmLabel="Remove category"
        pending={pending}
        error={error}
        onConfirm={onConfirm}
      />
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Plus, Users, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import type { Department } from "@/lib/api/types";
import { nextDepartmentColor } from "@/lib/departments";
import {
  addDepartment,
  removeDepartment,
  updateDepartment,
} from "@/app/(app)/admin/department-actions";

const plural = (n: number) => (n === 1 ? "1 item" : `${n} items`);

/** A colour swatch that opens the browser's colour picker. */
function Swatch({
  value,
  label,
  disabled,
  onPick,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onPick: (color: string) => void;
}) {
  // Follows the wheel while it is open; saved when the picker closes.
  const [shown, setShown] = useState(value);
  return (
    <label
      className="relative inline-flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-hover focus-within:ring-[3px] focus-within:ring-highlight/25"
      title={label}
    >
      <span className="h-5 w-5 rounded-full border border-border" style={{ background: shown }} />
      <input
        type="color"
        aria-label={label}
        value={shown}
        disabled={disabled}
        // Saved when the picker closes, not on every drag across the wheel.
        onChange={(e) => setShown(e.target.value)}
        onBlur={(e) => e.target.value !== value && onPick(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

/**
 * "Manage departments": the teams items can belong to. Add one, rename it,
 * give it a colour, or remove it. Removing a department keeps its items; they
 * simply have no department afterwards, which is why the count is shown.
 */
export function DepartmentManager({
  departments,
  counts,
}: {
  departments: Department[];
  /** Items per department id. */
  counts: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [target, setTarget] = useState<Department | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const newColor = color ?? nextDepartmentColor(departments);

  function run(action: () => Promise<{ error?: string }>, done?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else done?.();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Users /> Manage departments
          </Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5 pr-12">
            <DialogTitle>Manage departments</DialogTitle>
            <DialogDescription>
              The teams items belong to. Rename one by typing over its name; removing one keeps its
              items, with no department.
            </DialogDescription>
          </DialogHeader>

          {departments.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No departments yet. Add the first one below.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-y-auto">
              {departments.map((d) => (
                <li key={d.id} className="flex items-center gap-2 py-1 pl-4 pr-3">
                  <Swatch
                    key={d.color}
                    value={d.color}
                    label={`Colour of ${d.name}`}
                    disabled={pending}
                    onPick={(next) => run(() => updateDepartment(d.id, { color: next }))}
                  />
                  <Input
                    // Remount when a rename lands (or fails), so the box shows the saved name.
                    key={d.name}
                    aria-label={`Name of ${d.name}`}
                    defaultValue={d.name}
                    maxLength={40}
                    disabled={pending}
                    className="h-9 min-w-0 flex-1 border-transparent hover:border-input"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = d.name;
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next) e.target.value = d.name;
                      else if (next !== d.name) {
                        const el = e.target;
                        run(async () => {
                          const res = await updateDepartment(d.id, { name: next });
                          if (res.error) el.value = d.name;
                          return res;
                        });
                      }
                    }}
                  />
                  <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                    {plural(counts[d.id] ?? 0)}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setRemoveError(null);
                      setTarget(d);
                    }}
                    aria-label={`Remove department ${d.name}`}
                    title={`Remove “${d.name}”`}
                    className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex items-center gap-2 border-t border-border py-3 pl-4 pr-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => addDepartment(name, newColor),
                () => {
                  setName("");
                  setColor(null);
                },
              );
            }}
          >
            <Swatch key={newColor} value={newColor} label="Colour of the new department" onPick={setColor} />
            <Input
              aria-label="New department name"
              placeholder="New department, e.g. Operations"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              className="h-9 min-w-0 flex-1"
            />
            <Button type="submit" size="sm" disabled={pending || !name.trim()}>
              <Plus /> Add
            </Button>
          </form>
          {error ? (
            <p role="alert" className="px-6 pb-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title={target ? `Remove the department “${target.name}”?` : "Remove department"}
        description={
          target ? (
            <>
              {(counts[target.id] ?? 0) === 1 ? "1 item belongs" : `${counts[target.id] ?? 0} items belong`} to
              it. The items stay; they will have no department until you give them another.
            </>
          ) : null
        }
        confirmLabel="Remove department"
        pending={pending}
        error={removeError}
        onConfirm={() => {
          if (!target) return;
          setRemoveError(null);
          startTransition(async () => {
            const res = await removeDepartment(target.id);
            if (res.error) setRemoveError(res.error);
            else setTarget(null);
          });
        }}
      />
    </>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhotoField } from "@/components/dashboard/photo-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { editItem, type EditItemState } from "@/app/(app)/items/[id]/actions";
import type { Department, Item } from "@/lib/api/types";
import { DepartmentField } from "@/components/dashboard/department-field";

type Mode = "units" | "container" | "package";

function currentMode(item: Item): Mode {
  if (item.package_label) return "package";
  if (item.units_per_container > 1) return "container";
  return "units";
}

/**
 * Admin: edit an item's type / name / model / specification, and change how it is
 * counted — e.g. turn a per-unit item into a box holding N units so it behaves
 * exactly like an item created in container mode.
 */
export function EditItemForm({
  item,
  containerLabel,
  categories = [],
  departments,
}: {
  item: Item;
  containerLabel?: string | null;
  /** Categories already in use, offered as suggestions so free text doesn't
   *  drift into "Cables" / "cables" / "Cable" and split the report's grouping. */
  categories?: string[];
  /** null or empty: the form leaves the department field out. */
  departments?: Department[] | null;
}) {
  const action = editItem.bind(null, item.id);
  const [state, formAction, pending] = useActionState<EditItemState, FormData>(action, {});
  const was = currentMode(item);
  const [mode, setMode] = useState<Mode>(was);

  return (
    <form action={formAction} className="space-y-4 p-5">
      {state.error ? (
        <Alert variant="error">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok ? (
        <Alert variant="success">
          <AlertDescription>Item updated.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-type">Item type</Label>
          <Input id="edit-type" name="type" required defaultValue={item.type} />
          <p className="text-xs text-muted-foreground">
            Changing this reissues the SKU, since the SKU is built from the type.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" name="name" required defaultValue={item.name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-model">Model</Label>
          <Input id="edit-model" name="model" required defaultValue={item.model} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-sku">SKU</Label>
          {/* Assigned by the server; shown so it can be read off, not typed. */}
          <Input id="edit-sku" value={item.sku} readOnly disabled />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-specification">Specification</Label>
          <Input
            id="edit-specification"
            name="specification"
            defaultValue={item.specification ?? ""}
            placeholder="e.g. HP · 16GB RAM · 512GB SSD"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-category">Category</Label>
          {/* Free text with suggestions rather than a fixed dropdown — a new
              kind of thing shouldn't need a settings screen before it can be
              filed. `list` offers what's in use without restricting to it. */}
          <Input
            id="edit-category"
            name="category"
            list="edit-category-options"
            defaultValue={item.category ?? ""}
            placeholder="e.g. Computer Laptop, Cables"
          />
          <datalist id="edit-category-options">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            Groups this item on the condition report.
          </p>
        </div>
        {departments?.length ? (
          <DepartmentField idPrefix="edit" departments={departments} defaultValue={item.department_id} />
        ) : null}
        <div className="sm:col-span-2">
          <PhotoField
            idPrefix="edit"
            initialUrl={item.photo_url}
            initialHasPhoto={Boolean(item.has_photo)}
          />
        </div>
      </div>

      <div className="space-y-4 border-t border-line pt-4">
        <div className="space-y-2">
          <Label htmlFor="edit-mode">Counted as</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger id="edit-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="units">Individual units</SelectItem>
              <SelectItem value="container">Containers (track units inside)</SelectItem>
              <SelectItem value="package">Packages (don&apos;t count contents)</SelectItem>
            </SelectContent>
          </Select>
          {/* The Select is a controlled client component, so carry its value
              into the submitted form data. */}
          <input type="hidden" name="mode" value={mode} />
        </div>

        {mode === "container" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-units-per-container">Units per container</Label>
              <Input
                id="edit-units-per-container"
                name="units_per_container"
                type="number"
                min={2}
                required
                defaultValue={item.units_per_container > 1 ? item.units_per_container : 12}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-container-label">Container label</Label>
              <Input
                id="edit-container-label"
                name="container_label"
                required
                placeholder="e.g. box, pallet"
                defaultValue={containerLabel ?? "box"}
              />
            </div>
          </div>
        ) : null}

        {mode === "package" ? (
          <div className="space-y-2">
            <Label htmlFor="edit-package-label">Package label</Label>
            <Input
              id="edit-package-label"
              name="package_label"
              required
              placeholder="e.g. package, crate, reel"
              defaultValue={item.package_label ?? "package"}
            />
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {mode === "container"
            ? 'Stock stays counted in units — they are just shown grouped, e.g. "2 boxes (24 units)". Nothing is added or removed.'
            : mode === "package"
              ? was === "package"
                ? "Counted in whole packages; what is inside is not tracked."
                : "Careful: the numbers already recorded will be read as package counts, not units. Fix them with Adjust afterwards if that is not right."
              : was === "units"
                ? "Plain unit counting."
                : "Back to plain units — the recorded numbers do not change, they are just no longer grouped."}
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        <Save className="h-4 w-4" />
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

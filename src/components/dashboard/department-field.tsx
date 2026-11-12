"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Department } from "@/lib/api/types";

/** Shown in place of a department's dot when there is none. */
export function DepartmentDot({ color }: { color?: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border border-border"
      style={color ? { background: color, borderColor: color } : undefined}
    />
  );
}

/**
 * The department picker on the item forms. Submits `department_id`
 * ("" = no department), so the action can tell "none" from "not asked".
 */
export function DepartmentField({
  idPrefix,
  departments,
  defaultValue,
}: {
  idPrefix: string;
  departments: Department[];
  defaultValue?: string | null;
}) {
  const known = departments.some((d) => d.id === defaultValue);
  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-department`}>Department</Label>
      <Select name="department_id" defaultValue={known ? defaultValue! : "none"}>
        <SelectTrigger id={`${idPrefix}-department`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No department</SelectItem>
          {departments.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              <span className="inline-flex items-center gap-2">
                <DepartmentDot color={d.color} />
                {d.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">The team this item belongs to.</p>
    </div>
  );
}

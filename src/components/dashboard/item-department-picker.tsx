"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Department } from "@/lib/api/types";
import { setItemDepartment } from "@/app/(app)/admin/department-actions";
import { DepartmentDot } from "@/components/dashboard/department-field";

/** The department cell of the catalog table: pick one and it is saved. */
export function ItemDepartmentPicker({
  itemId,
  itemName,
  departments,
  value,
}: {
  itemId: string;
  itemName: string;
  departments: Department[];
  value: string | null;
}) {
  const [current, setCurrent] = useState(departments.some((d) => d.id === value) ? value! : "none");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    const before = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const res = await setItemDepartment(itemId, next === "none" ? null : next);
      if (res.error) {
        setCurrent(before);
        setError(res.error);
      }
    });
  }

  return (
    <div className="w-32">
      <Select value={current} onValueChange={onChange} disabled={pending}>
        <SelectTrigger aria-label={`Department of ${itemName}`} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <DepartmentDot /> None
            </span>
          </SelectItem>
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
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

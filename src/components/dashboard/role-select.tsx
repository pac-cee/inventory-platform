"use client";

import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeRole } from "@/app/(app)/admin/actions";
import { ASSIGNABLE_ROLES, roleLabel, type Role } from "@/lib/roles";

export function RoleSelect({
  id,
  role,
  isSelf,
}: {
  id: string;
  role: Role;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();

  // Don't let an admin change their own role here — avoids accidentally
  // locking yourself out of the admin area.
  if (isSelf) {
    return (
      <span className="rounded-full bg-highlight/15 px-2.5 py-0.5 text-xs font-medium text-highlight">
        {roleLabel(role)} (you)
      </span>
    );
  }

  function onChange(next: string) {
    if (next === role) return;
    startTransition(async () => {
      try {
        await changeRole(id, next as Role);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Could not change role.");
      }
    });
  }

  return (
    <Select key={role} defaultValue={role} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-8 w-[130px] text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSIGNABLE_ROLES.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeItem } from "@/app/(app)/admin/actions";

export function DeleteItemButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(`Delete "${name}" from the catalog? This can't be undone.`)) return;
    startTransition(async () => {
      try {
        await removeItem(id);
        router.push("/items");
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Could not delete item.");
      }
    });
  }

  return (
    <Button type="button" variant="danger" disabled={pending} onClick={onClick}>
      <Trash2 className="h-4 w-4" />
      {pending ? "Deleting…" : "Delete item"}
    </Button>
  );
}

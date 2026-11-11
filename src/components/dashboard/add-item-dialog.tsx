"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AddItemForm } from "@/components/dashboard/add-item-form";
import type { Department, Location } from "@/lib/api/types";

/**
 * "Add item" as a button + dialog, so the long form no longer pushes the
 * catalog (the thing people open this page for) off the first screen.
 */
export function AddItemDialog({
  locations,
  categories,
  departments,
}: {
  locations: Location[];
  categories: string[];
  /** null when the API has no departments: the form leaves the field out. */
  departments?: Department[] | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus /> Add item
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5 pr-12">
          <DialogTitle>Add item</DialogTitle>
          <DialogDescription>Add to the catalog. The SKU is assigned for you.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto">
          <AddItemForm locations={locations} categories={categories} departments={departments} onAdded={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

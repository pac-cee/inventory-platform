"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
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

const CloseContext = createContext<(() => void) | undefined>(undefined);

/** Inside a FormDialog: a function that closes it (undefined elsewhere). */
export function useFormDialogClose(): (() => void) | undefined {
  return useContext(CloseContext);
}

/**
 * A button that opens a form in a dialog — the pattern for "Add …" so a long
 * form does not push the list (what people came for) down the page. The header
 * stays put and the form scrolls inside. A form that should dismiss itself once
 * saved calls `useFormDialogClose()`. (Children are plain nodes, not a function:
 * a server page cannot pass a function to this client component.)
 */
export function FormDialog({
  title,
  description,
  triggerLabel,
  triggerIcon,
  size = "lg",
  children,
}: {
  title: string;
  description?: string;
  triggerLabel: string;
  triggerIcon?: ReactNode;
  size?: "md" | "lg";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          {triggerIcon ?? <Plus />} {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`flex max-h-[90vh] flex-col overflow-hidden p-0 ${size === "md" ? "max-w-xl" : "max-w-3xl"}`}
      >
        <DialogHeader className="border-b border-border px-6 py-5 pr-12">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <CloseContext.Provider value={() => setOpen(false)}>
          <div className="overflow-y-auto">{children}</div>
        </CloseContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

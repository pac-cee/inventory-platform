"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { editUser, type EditUserState } from "@/app/(app)/admin/actions";
import type { Profile } from "@/lib/api/types";

/**
 * Per-row admin action: edit another user's name, email, password, and limits.
 * Opens a small modal (the rest of the app uses inline panels, but a per-row
 * editor reads better as an overlay). Only filled-in fields are submitted.
 */
export function EditUserButton({ profile }: { profile: Profile }) {
  const id = profile.id;
  const fullName = profile.full_name ?? "";
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<EditUserState, FormData>(
    editUser.bind(null, id),
    {},
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  const label = fullName || "this user";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${label}`}
        title="Edit user"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
      >
        <Pencil className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {label}</DialogTitle>
          </DialogHeader>

          <form action={formAction} className="mt-4 space-y-4">
            {state.error ? (
              <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {state.error}
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor={`edit-name-${id}`}>Full name</Label>
              <Input
                id={`edit-name-${id}`}
                name="full_name"
                defaultValue={fullName}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-email-${id}`}>Email</Label>
              <Input
                id={`edit-email-${id}`}
                name="email"
                type="email"
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-password-${id}`}>New password</Label>
              <Input
                id={`edit-password-${id}`}
                name="password"
                type="text"
                minLength={6}
                placeholder="Leave blank to keep current"
              />
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Payment Settings</h4>
              
              <div className="flex items-center space-x-2">
                <input
                  id={`edit-payment-permission-${id}`}
                  name="has_payment_permission"
                  type="checkbox"
                  defaultChecked={!!profile.has_payment_permission}
                  className="h-4 w-4 rounded border-gray-300 text-highlight focus:ring-highlight"
                />
                <Label htmlFor={`edit-payment-permission-${id}`} className="text-sm font-medium cursor-pointer">
                  Allow payment requests (MoMo / Bank of Kigali)
                </Label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5 col-span-3 sm:col-span-1">
                  <Label htmlFor={`edit-daily-limit-${id}`} className="text-xs">Daily Limit (RWF)</Label>
                  <Input
                    id={`edit-daily-limit-${id}`}
                    name="daily_limit"
                    type="number"
                    min={0}
                    defaultValue={profile.daily_limit ?? 0}
                  />
                </div>
                <div className="space-y-1.5 col-span-3 sm:col-span-1">
                  <Label htmlFor={`edit-monthly-limit-${id}`} className="text-xs">Monthly Limit (RWF)</Label>
                  <Input
                    id={`edit-monthly-limit-${id}`}
                    name="monthly_limit"
                    type="number"
                    min={0}
                    defaultValue={profile.monthly_limit ?? 0}
                  />
                </div>
                <div className="space-y-1.5 col-span-3 sm:col-span-1">
                  <Label htmlFor={`edit-per-tx-limit-${id}`} className="text-xs">Per-Tx Limit (RWF)</Label>
                  <Input
                    id={`edit-per-tx-limit-${id}`}
                    name="per_transaction_limit"
                    type="number"
                    min={0}
                    defaultValue={profile.per_transaction_limit ?? 0}
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground font-medium">Only the fields you fill in will change.</p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                <Save className="h-4 w-4" />
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

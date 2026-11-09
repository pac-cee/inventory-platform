"use client";

import { useActionState, useEffect, useRef } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword, type ChangePasswordState } from "@/app/(app)/admin/actions";

/** Lets the signed-in user change their own password from Settings. */
export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 p-5">
      {state.error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          Password changed.
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="current_password">Current password</Label>
        <Input id="current_password" name="current_password" type="password" required autoComplete="current-password" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="new_password">New password</Label>
          <Input id="new_password" name="new_password" type="password" required minLength={6} autoComplete="new-password" placeholder="At least 6 characters" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <Input id="confirm_password" name="confirm_password" type="password" required minLength={6} autoComplete="new-password" />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        <KeyRound className="h-4 w-4" />
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}

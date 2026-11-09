"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile, type UpdateProfileState } from "@/app/(app)/admin/actions";

export function EditProfileForm({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState<UpdateProfileState, FormData>(
    updateProfile,
    {},
  );

  return (
    <form action={formAction} className="space-y-4 p-5">
      {state.error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.ok ? (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          Profile updated.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" defaultValue={fullName} required placeholder="Jane Doe" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={email} required placeholder="person@company.com" />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        <Save className="h-4 w-4" />
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

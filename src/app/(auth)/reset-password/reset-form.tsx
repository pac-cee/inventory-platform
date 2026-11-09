"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, BackToSignIn } from "@/components/blocks/auth-card";
import { resetPasswordAction } from "../actions";

/**
 * Setting a password from a link that carries no password of its own — an admin
 * invite, or a reset requested without one.
 *
 * The everyday route is /forgot-password, which takes the new password up front
 * and confirms it by email. This page stays for links already in inboxes.
 */
export function ResetForm({ token }: { token?: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, { ok: false });

  if (state.ok) {
    return (
      <AuthCard title="Password reset" footer={<BackToSignIn />}>
        <p className="text-sm text-muted-foreground">
          Your password has been reset and every other session has been signed out. You can sign
          in now.
        </p>
      </AuthCard>
    );
  }

  if (!token) {
    return (
      <AuthCard title="Link is incomplete" footer={<BackToSignIn />}>
        <p className="text-sm text-muted-foreground">
          This link is missing its token. Start again from &ldquo;Forgot password?&rdquo; on the
          sign-in page.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a password" description="This link sets the password for your account.">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 6 characters"
            autoComplete="new-password"
            minLength={6}
            required
            autoFocus
          />
        </div>

        {state.error ? <p className="text-[12px] text-destructive">{state.error}</p> : null}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Set password"}
        </Button>
      </form>
    </AuthCard>
  );
}

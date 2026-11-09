"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, BackToSignIn } from "@/components/blocks/auth-card";
import { forgotPasswordAction } from "../actions";

/**
 * Email plus the password you want. Nothing changes on submit: the API mails
 * the owner of that address, and the new password only takes effect when they
 * confirm from their inbox.
 */
export function ForgotForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, { ok: false });

  if (state.ok) {
    return (
      <AuthCard
        title="Check your email"
        description="Almost there — one click to finish."
        footer={<BackToSignIn />}
      >
        <p className="text-sm text-muted-foreground">
          If that address has an account, we&rsquo;ve emailed it a link to confirm the change.
          Your password stays as it is until you click it.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Didn&rsquo;t ask for this? The same email has a link to refuse it.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Choose a new password. We'll email you to confirm it's really you."
      footer={<BackToSignIn />}
    >
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            autoFocus
          />
        </div>

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
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <Input
            id="confirm_password"
            name="confirm_password"
            type="password"
            placeholder="Type it again"
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>

        {state.error ? <p className="text-[12px] text-destructive">{state.error}</p> : null}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Sending…" : "Email me to confirm"}
        </Button>
      </form>
    </AuthCard>
  );
}

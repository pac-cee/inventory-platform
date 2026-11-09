"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { AuthCard, BackToSignIn } from "@/components/blocks/auth-card";
import { confirmPasswordResetAction, denyPasswordResetAction } from "../actions";

/**
 * The two ends of the emailed confirmation.
 *
 * Neither happens on page load. A mail client that pre-fetches links would
 * otherwise decide for you — and "confirm" is exactly the decision that must be
 * a deliberate click. Both pages offer the other choice, so someone who opens
 * the wrong one is not stuck.
 */
export function DecisionForm({
  token,
  decision,
}: {
  token?: string;
  decision: "confirm" | "deny";
}) {
  const [done, setDone] = useState<"confirm" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!token) {
    return (
      <AuthCard title="Link is incomplete" footer={<BackToSignIn />}>
        <p className="text-sm text-muted-foreground">
          This link is missing its token. Open the most recent email, or start again from
          &ldquo;Forgot password?&rdquo; on the sign-in page.
        </p>
      </AuthCard>
    );
  }

  function act(which: "confirm" | "deny") {
    setError(null);
    startTransition(async () => {
      const res =
        which === "confirm"
          ? await confirmPasswordResetAction(token as string)
          : await denyPasswordResetAction(token as string);
      if (res.ok) setDone(which);
      else setError(res.error ?? "Something went wrong.");
    });
  }

  if (done === "confirm") {
    return (
      <AuthCard title="Password changed" footer={<BackToSignIn />}>
        <p className="text-sm text-muted-foreground">
          Your new password is live and every other session has been signed out. Sign in with it
          now.
        </p>
      </AuthCard>
    );
  }

  if (done === "deny") {
    return (
      <AuthCard title="Change refused" footer={<BackToSignIn />}>
        <p className="text-sm text-muted-foreground">
          Nothing was changed and your current password still works. If you never asked for this,
          tell an administrator — someone knows your email address.
        </p>
      </AuthCard>
    );
  }

  const confirming = decision === "confirm";

  return (
    <AuthCard
      title={confirming ? "Confirm your new password" : "Refuse this change?"}
      description={
        confirming
          ? "Nothing has changed yet."
          : "This cancels the request and leaves your password as it is."
      }
      footer={<BackToSignIn />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {confirming
            ? "Someone entered a new password for your account. If that was you, confirm it below and it takes effect straight away."
            : "Refusing kills the request. Your current password keeps working."}
        </p>

        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}

        <Button
          type="button"
          onClick={() => act(decision)}
          disabled={pending}
          variant={confirming ? "default" : "danger"}
          className="w-full"
        >
          {pending
            ? "Working…"
            : confirming
              ? "Yes, change my password"
              : "Refuse this change"}
        </Button>

        <Button
          type="button"
          onClick={() => act(confirming ? "deny" : "confirm")}
          disabled={pending}
          variant="outline"
          className="w-full"
        >
          {confirming ? "It wasn't me — refuse it" : "Actually, it was me — confirm it"}
        </Button>
      </div>
    </AuthCard>
  );
}

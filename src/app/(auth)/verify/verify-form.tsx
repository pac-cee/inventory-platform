"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard, BackToSignIn } from "@/components/blocks/auth-card";
import { verifyEmailAction, resendVerificationAction } from "../actions";

export function VerifyForm({
  token,
  arrivedFrom,
}: {
  token?: string;
  arrivedFrom?: "signup" | "login";
}) {
  const [state, formAction, pending] = useActionState(verifyEmailAction, {
    ok: false,
  });
  // Separate state: resending is an independent outcome from verifying, and it
  // must stay available when there's no token at all.
  const [resend, resendAction, resending] = useActionState(resendVerificationAction, {
    ok: false,
  });

  if (state.ok) {
    return (
      <AuthCard title="Email verified" footer={<BackToSignIn />}>
        <p className="text-sm text-muted-foreground">
          Your email is confirmed. You can now sign in.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Verify your email" footer={<BackToSignIn />}>
      <div className="flex flex-col gap-4">
        {token ? (
          <form action={formAction}>
            {/* Inside the form: a hidden field outside it is not submitted, so
                the action saw no token and refused its own link. */}
            <input type="hidden" name="token" value={token} />
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Verifying…" : "Verify email"}
            </Button>
          </form>
        ) : arrivedFrom === "signup" ? (
          <p className="text-sm text-muted-foreground">
            Your account is created. Check your inbox for the link that confirms your address. An
            administrator then has to approve the account before you can sign in — you will get an
            email as soon as they do.
          </p>
        ) : arrivedFrom === "login" ? (
          <p className="text-sm text-muted-foreground">
            That account still needs verifying. Use the link from your signup email, or send
            yourself a new one below.
          </p>
        ) : (
          <p className="text-[12px] text-destructive">
            This verification link is missing its token.
          </p>
        )}

        {state.error ? <p className="text-[12px] text-destructive">{state.error}</p> : null}

        {/* Recovery path: the link expired, never arrived, or the send failed
            on signup. Without this an unverified account can never sign in. */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Link expired or never arrived? Send a new one.
          </p>
          <form action={resendAction} className="flex flex-col gap-3">
            <Input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
            <Button type="submit" variant="outline" disabled={resending} className="w-full">
              {resending ? "Sending…" : "Resend verification email"}
            </Button>
          </form>
          {resend.message ? (
            <p className="text-sm text-muted-foreground">{resend.message}</p>
          ) : null}
          {resend.error ? <p className="text-[12px] text-destructive">{resend.error}</p> : null}
        </div>
      </div>
    </AuthCard>
  );
}

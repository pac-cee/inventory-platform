"use client";

import { useActionState } from "react";
import { Register01 } from "@/components/blocks/register-01";
import { VerletLogo } from "@/components/ui/verlet-logo";
import { signup, type AuthFormState } from "../actions";

export function SignupForm({ error }: { error?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signup,
    { error },
  );

  return (
    <Register01
      title="Create an account"
      description="Request access to your team's inventory."
      error={state?.error}
      loading={pending}
      loginHref="/login"
      logo={
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-highlight text-highlight-foreground">
          <VerletLogo className="h-6 w-6" />
        </div>
      }
      action={formAction}
    />
  );
}

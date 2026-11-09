"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { VerletLogo } from "@/components/ui/verlet-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type AuthFormState } from "../actions";

export function LoginForm({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    login,
    { error },
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <header className="mb-6 flex flex-col items-center gap-2 text-center">
        <VerletLogo className="size-10" />
        <h1 className="font-serif text-2xl tracking-tight">Verlet Inventory</h1>
      </header>
      <section
        aria-labelledby="sign-in-title"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-[0_2px_4px_rgba(0,0,0,0.02),0_12px_32px_rgba(0,0,0,0.06)] backdrop-blur-xl sm:p-7"
      >
        <h2 id="sign-in-title" className="text-center text-lg font-medium">
          Sign in to your account
        </h2>
        {message && (
          <p
            role="status"
            className="mt-4 rounded-lg bg-success-soft px-3 py-2 text-center text-sm"
          >
            {message}
          </p>
        )}
        <form
          action={formAction}
          className="mt-5 flex flex-col gap-4"
          aria-busy={pending}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                className="h-10 pr-12"
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
          {state?.error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          )}
          <Button
            type="submit"
            variant="highlight"
            disabled={pending}
            className="mt-1 h-10 w-full motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            {pending ? (
              <>
                <Loader2
                  aria-hidden
                  className="animate-spin motion-reduce:animate-none"
                />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <Link
              href="/forgot-password"
              className="transition-colors hover:text-foreground"
            >
              Forgot password?
            </Link>
            <Link
              href="/signup"
              className="transition-colors hover:text-foreground"
            >
              Create account
            </Link>
          </div>
        </form>
      </section>
      <footer className="mt-6 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} Verlet Robotics
      </footer>
    </main>
  );
}

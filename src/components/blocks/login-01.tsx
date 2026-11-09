"use client"

import * as React from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface Login01Props extends Omit<React.ComponentProps<"div">, "onSubmit"> {
  onSubmit?: (data: { email: string; password: string }) => void
  /** Server action to bind to the form; takes precedence over `onSubmit`. */
  action?: React.ComponentProps<"form">["action"]
  error?: string
  loading?: boolean
  forgotPasswordHref?: string
  registerHref?: string
  logo?: React.ReactNode
  title?: string
  description?: string
  socialButtons?: React.ReactNode
}

function Login01({
  onSubmit,
  action,
  error,
  loading = false,
  forgotPasswordHref,
  registerHref,
  logo,
  title = "Sign in",
  description = "Enter your credentials to continue.",
  socialButtons,
  className,
  ...props
}: Login01Props) {
  const emailId = React.useId()
  const passwordId = React.useId()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    onSubmit?.({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
    })
  }

  return (
    <div
      data-slot="login-01"
      className={cn(
        "fixed inset-0 flex items-center justify-center overflow-y-auto bg-background p-4",
        className
      )}
      {...props}
    >
      <div className="relative my-auto w-full max-w-sm">
        {logo && (
          <div className="absolute bottom-full left-0 right-0 mb-6 flex items-center justify-center">
            {logo}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              {...(action ? { action } : { onSubmit: handleSubmit })}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor={emailId}>Email</Label>
                <Input
                  id={emailId}
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={passwordId}>Password</Label>
                  {forgotPasswordHref && (
                    <a
                      href={forgotPasswordHref}
                      className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Forgot password?
                    </a>
                  )}
                </div>
                <Input
                  id={passwordId}
                  name="password"
                  type="password"
                  placeholder="Enter password..."
                  autoComplete="current-password"
                  required
                />
              </div>

              {error && (
                <p className="text-[12px] text-destructive">{error}</p>
              )}

              <Button type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </Button>

              {socialButtons && (
                <>
                  <div className="relative flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                      or
                    </span>
                    <Separator className="flex-1" />
                  </div>
                  {socialButtons}
                </>
              )}

              {registerHref && (
                <p className="text-center text-[12px] text-muted-foreground">
                  Don&apos;t have an account?{" "}
                  <a
                    href={registerHref}
                    className="text-foreground hover:text-highlight transition-colors font-medium"
                  >
                    Sign up
                  </a>
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { Login01 }
export type { Login01Props }

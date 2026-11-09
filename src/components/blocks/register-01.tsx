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
import { cn } from "@/lib/utils"

interface Register01Props extends Omit<React.ComponentProps<"div">, "onSubmit"> {
  onSubmit?: (data: { name: string; email: string; password: string }) => void
  /** Server action to bind to the form; takes precedence over `onSubmit`. */
  action?: React.ComponentProps<"form">["action"]
  error?: string
  loading?: boolean
  loginHref?: string
  logo?: React.ReactNode
  title?: string
  description?: string
}

function Register01({
  onSubmit,
  action,
  error,
  loading = false,
  loginHref,
  logo,
  title = "Create an account",
  description = "Enter your details to get started.",
  className,
  ...props
}: Register01Props) {
  const nameId = React.useId()
  const emailId = React.useId()
  const passwordId = React.useId()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    onSubmit?.({
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      password: formData.get("password") as string,
    })
  }

  return (
    <div
      data-slot="register-01"
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
                <Label htmlFor={nameId}>Name</Label>
                <Input
                  id={nameId}
                  name="name"
                  type="text"
                  placeholder="Your name"
                  autoComplete="name"
                  required
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={emailId}>Email</Label>
                <Input
                  id={emailId}
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={passwordId}>Password</Label>
                <Input
                  id={passwordId}
                  name="password"
                  type="password"
                  placeholder="Create a password..."
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && (
                <p className="text-[12px] text-destructive">{error}</p>
              )}

              <Button type="submit" disabled={loading}>
                {loading ? "Creating account..." : "Create account"}
              </Button>

              {loginHref && (
                <p className="text-center text-[12px] text-muted-foreground">
                  Already have an account?{" "}
                  <a
                    href={loginHref}
                    className="text-foreground hover:text-highlight transition-colors font-medium"
                  >
                    Sign in
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

export { Register01 }
export type { Register01Props }

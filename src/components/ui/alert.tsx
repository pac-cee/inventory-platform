"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative flex gap-3 rounded-xl border px-4 py-3 text-[13px]",
  {
    variants: {
      variant: {
        info: "bg-info-soft border-info/20 text-foreground",
        success: "bg-success-soft border-success/20 text-foreground",
        warning: "bg-warning-soft border-warning/20 text-foreground",
        error: "bg-destructive-soft border-destructive/20 text-foreground",
        destructive: "bg-destructive text-destructive-foreground border-destructive",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
)

const variantIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  destructive: XCircle,
} as const

const variantIconColors = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  destructive: "text-destructive-foreground",
} as const

interface AlertProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof alertVariants> {
  icon?: React.ElementType | false
  dismissible?: boolean
  onDismiss?: () => void
}

function Alert({
  className,
  variant = "info",
  icon,
  dismissible,
  onDismiss,
  children,
  ...props
}: AlertProps) {
  const [visible, setVisible] = React.useState(true)

  if (!visible) return null

  const IconComp = icon === false ? null : icon || variantIcons[variant!]
  const iconColor = variantIconColors[variant!]

  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {IconComp && (
        <IconComp
          className={cn("size-4 shrink-0 mt-0.5", iconColor)}
        />
      )}
      <div className="flex-1 min-w-0">{children}</div>
      {dismissible && (
        <button
          type="button"
          onClick={() => {
            setVisible(false)
            onDismiss?.()
          }}
          className={cn(
            "shrink-0 mt-0.5 rounded-md p-0.5 opacity-60 hover:opacity-100 transition-opacity",
            variant === "destructive"
              ? "text-destructive-foreground"
              : "text-foreground"
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-medium leading-none mb-1", className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-[12px] opacity-80 leading-relaxed", className)}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("mt-2 flex items-center gap-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction, alertVariants }

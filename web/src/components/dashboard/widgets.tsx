import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusFor, type StockStatus } from "@/lib/inventory";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
}) {
  return (
    <div className="h-full rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">
          {label}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 font-mono text-[1.75rem] font-light leading-none text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const STATUS_STYLES: Record<StockStatus, { label: string; className: string }> =
  {
    out: {
      label: "Out of stock",
      className:
        "bg-warning-soft text-amber-700 dark:text-warning border-warning/20",
    },
    low: {
      label: "Low",
      className:
        "bg-warning-soft text-amber-700 dark:text-warning border-warning/20",
    },
    ok: { label: "In stock", className: "text-success border-transparent" },
  };

export function StatusBadge({
  quantity,
  capacity,
}: {
  quantity: number;
  capacity?: number;
}) {
  const { label, className } = STATUS_STYLES[statusFor(quantity, capacity)];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** A titled surface used for the dashboard sections. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-2xl border border-border bg-card", className)}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

// Verlet input: h-11, rounded-lg, 13px, pink highlight focus ring. Compact mode
// via the data-compact attribute (e.g. <Input data-compact="" />).
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    data-slot="input"
    className={cn(
      "flex h-11 w-full rounded-lg border border-input bg-transparent px-3 text-[13px] text-foreground transition-[color,border-color,box-shadow] file:border-0 file:bg-transparent file:text-[13px] file:font-medium placeholder:text-muted-foreground focus-visible:border-highlight focus-visible:outline-none focus-visible:ring-highlight/25 focus-visible:ring-[3px] aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:opacity-50 data-[compact]:h-8 data-[compact]:rounded-md data-[compact]:text-[12px]",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };

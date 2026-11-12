import Link from "next/link";
import { cn } from "@/lib/utils";
import { LinkPending } from "@/components/ui/link-pending";
import type { Department } from "@/lib/api/types";
import { NO_DEPARTMENT } from "@/lib/departments";
import { categoryHref } from "@/lib/category-filter";
import { DepartmentDot } from "@/components/dashboard/department-field";

/**
 * Filter chips for departments, under the category chips: every department
 * with its colour and item count, and "No department" when some items have
 * none. Links, so the filter lives in the address like the category one.
 */
export function DepartmentChips({
  departments,
  counts,
  none,
  active,
  category,
  query,
}: {
  departments: Department[];
  counts: Record<string, number>;
  none: number;
  /** "" = all; NO_DEPARTMENT = items with none; otherwise a department id. */
  active?: string;
  category?: string;
  query?: string;
}) {
  const href = (department?: string) => categoryHref(category || null, query, department);
  const chips = [
    { key: "all", label: "All departments", count: null as number | null, color: undefined as string | undefined, href: href(), on: !active, dot: false },
    ...departments.map((d) => ({ key: d.id, label: d.name, count: counts[d.id] ?? 0, color: d.color, href: href(d.id), on: active === d.id, dot: true })),
    ...(none > 0 && departments.length
      ? [{ key: "none", label: "No department", count: none, color: undefined, href: href(NO_DEPARTMENT), on: active === NO_DEPARTMENT, dot: true }]
      : []),
  ];
  return (
    <nav aria-label="Filter by department" className="flex flex-wrap gap-2 px-5 pb-4">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          aria-current={c.on ? "true" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-full border border-border px-3.5 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25",
            c.on ? "bg-nav-current" : "hover:bg-hover",
          )}
        >
          {c.dot ? <DepartmentDot color={c.color} /> : null}
          <span className="max-w-[16rem] truncate">{c.label}</span>
          {c.count !== null ? (
            <span className={cn("text-xs tabular-nums", c.on ? "opacity-90" : "text-muted-foreground")}>{c.count}</span>
          ) : null}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}

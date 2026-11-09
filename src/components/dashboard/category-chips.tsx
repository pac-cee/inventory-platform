import Link from "next/link";
import { cn } from "@/lib/utils";
import { LinkPending } from "@/components/ui/link-pending";
import { UNCATEGORIZED, categoryHref } from "@/lib/category-filter";

export interface CategoryChip {
  category: string;
  items: number;
}

/**
 * One row of filter chips above the catalog: All, each category with its count,
 * and Uncategorized when some items have none. Plain links, so the filter lives
 * in the address (shareable, back button works) and the chips wrap on a phone.
 */
export function CategoryChips({
  categories,
  active,
  total,
  uncategorized,
  query,
}: {
  categories: CategoryChip[];
  /** "" = all; UNCATEGORIZED = items with none; otherwise the exact category. */
  active?: string;
  total: number;
  uncategorized: number;
  query?: string;
}) {
  const chips: {
    key: string;
    label: string;
    count: number;
    href: string;
    on: boolean;
  }[] = [
    {
      key: "all",
      label: "All",
      count: total,
      href: categoryHref(null, query),
      on: !active,
    },
    ...categories.map((c) => ({
      key: `c:${c.category}`,
      label: c.category,
      count: c.items,
      href: categoryHref(c.category, query),
      on: active === c.category,
    })),
    ...(uncategorized > 0
      ? [
          {
            key: "none",
            label: "Uncategorized",
            count: uncategorized,
            href: categoryHref(UNCATEGORIZED, query),
            on: active === UNCATEGORIZED,
          },
        ]
      : []),
  ];

  return (
    <nav
      aria-label="Filter by category"
      className="flex flex-wrap gap-2 px-5 pb-4"
    >
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          aria-current={c.on ? "true" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25",
            c.on
              ? "border-border bg-nav-current text-foreground"
              : "border-border text-foreground hover:bg-hover",
          )}
        >
          <span className="max-w-[16rem] truncate">{c.label}</span>
          <span
            className={cn(
              "text-xs tabular-nums",
              c.on ? "opacity-90" : "text-muted-foreground",
            )}
          >
            {c.count}
          </span>
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}

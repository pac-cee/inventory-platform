import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageRange } from "@/lib/paginate";
import { LinkPending } from "@/components/ui/link-pending";

/**
 * Next/Previous under a long table.
 *
 * Plain links carrying ?page=, not state: these tables live in server
 * components, so a link is what keeps the page shareable and the Back button
 * working. Any other query the page reads — the search box's ?q= — is carried
 * along, or paging would silently drop the filter.
 */
export function Pager({
  page,
  total,
  size,
  basePath,
  params = {},
  label = "rows",
}: {
  /** The requested page; out-of-range values are pulled back into range. */
  page: unknown;
  total: number;
  size: number;
  /** Where the links point, e.g. "/items". */
  basePath: string;
  /** Other query params to preserve, e.g. { q: "cable" }. */
  params?: Record<string, string | undefined>;
  /** What is being counted, for the "51–100 of 106 items" line. */
  label?: string;
}) {
  const { from, to, page: current, pages } = pageRange(page, total, size);

  const href = (n: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    // Page 1 is the bare URL, so the common case has no query noise.
    if (n > 1) qs.set("page", String(n));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  // One page of results needs no controls, but the count is still worth saying.
  const step =
    "inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs transition-colors";

  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
      <p className="text-xs tabular-nums text-muted-foreground">
        {total === 0 ? `No ${label}` : `${from}–${to} of ${total} ${label}`}
      </p>

      {pages > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {current} of {pages}
          </span>
          {current > 1 ? (
            <Link href={href(current - 1)} rel="prev" className={`${step} hover:bg-muted`}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Previous
              <LinkPending />
            </Link>
          ) : (
            <span className={`${step} cursor-not-allowed text-muted-foreground opacity-50`}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Previous
            </span>
          )}
          {current < pages ? (
            <Link href={href(current + 1)} rel="next" className={`${step} hover:bg-muted`}>
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              <LinkPending />
            </Link>
          ) : (
            <span className={`${step} cursor-not-allowed text-muted-foreground opacity-50`}>
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

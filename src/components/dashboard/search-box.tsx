"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Boxes, MapPin, Search } from "lucide-react";
import { stockSummary, type StockPlace } from "@/lib/stock-summary";
import {
  globalSearchHref,
  shouldAdoptUrlQuery,
  splitMatch,
} from "@/lib/search";

interface ItemHit {
  id: string;
  name: string;
  sku: string | null;
  specification: string | null;
  /** Units on a shelf and the top places; null if the stock lookup failed. */
  total: number | null;
  places: StockPlace[];
}
interface LocationHit {
  id: string;
  name: string;
  path: string;
}
interface Results {
  items: ItemHit[];
  locations: LocationHit[];
}

type Row =
  | { kind: "item"; key: string; href: string; hit: ItemHit }
  | { kind: "location"; key: string; href: string; hit: LocationHit }
  | { kind: "filter"; key: string };

const EMPTY: Results = { items: [], locations: [] };

/** An item result: its name, how many there are, and where the most are. */
function ItemRow({ hit, query }: { hit: ItemHit; query: string }) {
  // total is null when the stock lookup failed: say nothing rather than "none".
  const stock = hit.total === null ? null : stockSummary(hit.total, hit.places);
  return (
    <>
      <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-fg">
            <Highlight text={hit.name} query={query} />
          </span>
          {stock ? (
            <span
              className={`shrink-0 text-xs font-medium ${stock.inStock ? "text-success" : "text-muted-foreground"}`}
            >
              {stock.count}
            </span>
          ) : null}
        </span>
        {stock?.where ? (
          <span className="block truncate text-xs text-muted-foreground">
            {stock.where}
          </span>
        ) : null}
        {(hit.sku || hit.specification) && (
          <span className="block truncate text-[11px] text-muted-foreground/80">
            {[hit.sku, hit.specification].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </>
  );
}

/** Emphasises the part of `text` that matched what was typed. */
function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatch(text, query).map((p, i) =>
        p.match ? (
          <strong key={i} className="font-semibold text-foreground">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Global item/location search. Choosing a suggestion opens its detail;
 * Enter without a selection opens all matching results. */
export function SearchBox({ prominent = false }: { prominent?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQuery = pathname === "/search" ? (params.get("q") ?? "") : "";

  const listId = useId();
  const [value, setValue] = useState(urlQuery);
  const [open, setOpen] = useState(false);
  // The answer and the query it answers: "still loading" is simply "the answer
  // on screen is for an older query", so there is no loading flag to keep in sync.
  const [answer, setAnswer] = useState<{ q: string; data: Results }>({
    q: "",
    data: EMPTY,
  });
  const [active, setActive] = useState(-1);

  const focused = useRef(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror the URL, but only when the user is not typing.
  useEffect(() => {
    if (shouldAdoptUrlQuery({ focused: focused.current, urlQuery, value }))
      setValue(urlQuery);
    // `value` is deliberately not a dependency: this reacts to the URL changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  // Suggestions: debounced, and a newer keystroke cancels the older request so
  // a slow answer can never replace a fresher one.
  useEffect(() => {
    const q = value.trim();
    if (!open || !q) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        // An expired session redirects to the login page: HTML, not JSON.
        const ok =
          res.ok && (res.headers.get("content-type") ?? "").includes("json");
        setAnswer({ q, data: ok ? ((await res.json()) as Results) : EMPTY });
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setAnswer({ q, data: EMPTY });
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, open]);

  // Close when clicking anywhere else.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapper.current && !wrapper.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = value.trim();
  const results = answer.q === q ? answer.data : EMPTY;
  const loading = q.length > 0 && answer.q !== q;
  const rows: Row[] = q
    ? [
        ...results.items.map((hit) => ({
          kind: "item" as const,
          key: `i-${hit.id}`,
          href: `/items/${hit.id}`,
          hit,
        })),
        ...results.locations.map((hit) => ({
          kind: "location" as const,
          key: `l-${hit.id}`,
          href: `/locations/${hit.id}`,
          hit,
        })),
        { kind: "filter" as const, key: "filter" },
      ]
    : [];

  /** Open the dedicated results page, regardless of the current route. */
  function submitSearch(next = value) {
    const trimmed = next.trim();
    router.push(globalSearchHref(trimmed));
    setOpen(false);
  }

  function choose(row: Row) {
    setOpen(false);
    if (row.kind === "filter") submitSearch();
    else router.push(row.href);
  }

  function onChange(next: string) {
    setValue(next);
    setActive(-1);
    setOpen(true);
    // Clearing a query on the search page also clears its URL filter.
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (!next.trim() && urlQuery) {
      clearTimer.current = setTimeout(() => submitSearch(""), 300);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % rows.length);
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? rows.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && rows[active]) choose(rows[active]);
      else submitSearch();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const placeholder = "Search items, locations…";
  const showPanel = open && q.length > 0;
  const noMatches =
    !loading && results.items.length === 0 && results.locations.length === 0;

  return (
    <div
      ref={wrapper}
      className={prominent ? "relative w-full" : "relative w-full max-w-sm"}
    >
      <div
        className={`flex w-full items-center gap-3 border border-border bg-card text-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 ${prominent ? "min-h-20 rounded-2xl px-5 sm:min-h-24" : "h-9 rounded-lg px-3"}`}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            focused.current = true;
            if (value.trim()) setOpen(true);
          }}
          onBlur={() => {
            focused.current = false;
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          className={`min-w-0 w-full bg-transparent text-fg placeholder:text-muted-foreground focus:outline-none ${prominent ? "text-base" : "text-[13px]"}`}
        />
        {prominent && (
          <button
            type="button"
            onClick={() => submitSearch()}
            aria-label="Search inventory"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-highlight text-highlight-foreground transition-colors hover:bg-highlight/85 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowUpRight className="size-4" />
          </button>
        )}
      </div>

      {showPanel && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[70vh] overflow-auto rounded-lg border border-line bg-popover py-1 text-sm text-popover-foreground shadow-lg"
        >
          {loading && rows.length <= 1 && (
            <li role="presentation" className="px-3 py-2 text-muted-foreground">
              Searching…
            </li>
          )}
          {noMatches && (
            <li role="presentation" className="px-3 py-2 text-muted-foreground">
              No item or location matches “{q}”.
            </li>
          )}

          {rows.map((row, i) => {
            const isActive = i === active;
            const base = `flex cursor-pointer items-center gap-3 px-3 py-2 ${isActive ? "bg-highlight-soft" : "hover:bg-hover"}`;
            const prevKind = i > 0 ? rows[i - 1].kind : null;
            const heading =
              row.kind !== "filter" && row.kind !== prevKind ? (
                <li
                  key={`h-${row.kind}`}
                  role="presentation"
                  className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {row.kind === "item" ? "Items" : "Locations"}
                </li>
              ) : null;

            return (
              <span key={row.key} className="contents">
                {heading}
                <li
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isActive}
                  className={base}
                  onMouseEnter={() => setActive(i)}
                  // mousedown, not click: the input's blur must not close the
                  // panel before the choice registers.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(row);
                  }}
                >
                  {row.kind === "item" && <ItemRow hit={row.hit} query={q} />}
                  {row.kind === "location" && (
                    <>
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-fg">
                        <Highlight text={row.hit.path} query={q} />
                      </span>
                    </>
                  )}
                  {row.kind === "filter" && (
                    <>
                      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        See all results for “{q}”
                      </span>
                      <kbd className="rounded border border-line px-1.5 text-[10px] text-muted-foreground">
                        Enter
                      </kbd>
                    </>
                  )}
                </li>
              </span>
            );
          })}
        </ul>
      )}
    </div>
  );
}

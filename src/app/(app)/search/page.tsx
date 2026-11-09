import Link from "next/link";
import { Boxes, ChevronRight, MapPin } from "lucide-react";
import { serverApi } from "@/lib/api/server";
import { fetchAllItems } from "@/lib/api/items";
import { locationPath, rankItems, rankLocations } from "@/lib/search";
import { totalsByItem, capacityByItem } from "@/lib/inventory";
import { StatusBadge } from "@/components/dashboard/widgets";
import { Pager } from "@/components/dashboard/pager";
import { PAGE_SIZE, pageOf } from "@/lib/paginate";
import type { Item, Location, StockLevel } from "@/lib/api/types";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";
  const api = serverApi();
  let data: [Item[], Location[], StockLevel[]] | null = null;
  try {
    data = await Promise.all([
      fetchAllItems(api),
      api.get<Location[]>("/locations"),
      api.get<StockLevel[]>("/stock"),
    ]);
  } catch {
    /* Render an explicit unavailable state below. */
  }
  if (!data)
    return (
      <div
        role="alert"
        className="mx-auto max-w-[900px] rounded-2xl border border-border p-6"
      >
        Search is unavailable. Refresh to try again.
      </div>
    );
  const [allItems, allLocations, stock] = data;
  const items = query ? rankItems(allItems, query, allItems.length) : allItems;
  const locations = query
    ? rankLocations(allLocations, query, allLocations.length)
    : allLocations;
  const totals = totalsByItem(stock);
  const capacity = capacityByItem(stock);
  const byId = new Map(allLocations.map((l) => [l.id, l]));
  const results = [
    ...items.map((item) => ({ kind: "item" as const, item })),
    ...locations.map((location) => ({ kind: "location" as const, location })),
  ];
  const shown = pageOf(results, sp.page);
  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-4">
      <div className="text-center">
        <h1 className="font-serif text-3xl">
          {query ? `Results for “${query}”` : "Find anything in inventory"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {items.length} items · {locations.length} locations
        </p>
      </div>
      <section
        className="overflow-hidden rounded-2xl border border-border bg-card"
        aria-label="Search results"
      >
        {!results.length && (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No matches. Try an item name, SKU, model, or location.
          </p>
        )}
        {shown.map((result) =>
          result.kind === "item" ? (
            <Link
              key={`i-${result.item.id}`}
              href={`/items/${result.item.id}`}
              className="action-row group"
            >
              <Boxes className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {result.item.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {result.item.type} · {result.item.sku}
                </span>
              </span>
              <StatusBadge
                quantity={totals.get(result.item.id) ?? 0}
                capacity={capacity.get(result.item.id) ?? 0}
              />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ) : (
            <Link
              key={`l-${result.location.id}`}
              href={`/locations/${result.location.id}`}
              className="action-row group"
            >
              <MapPin className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {locationPath(result.location, byId)}
              </span>
              <span className="text-xs text-muted-foreground">Location</span>
              <ChevronRight className="size-4" />
            </Link>
          ),
        )}
      </section>
      <Pager
        page={sp.page}
        total={results.length}
        size={PAGE_SIZE}
        basePath="/search"
        params={{ q: query }}
        label="results"
      />
    </div>
  );
}

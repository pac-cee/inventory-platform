import Link from "next/link";
import { redirect } from "next/navigation";
import { Warehouse, ChevronRight, QrCode } from "lucide-react";
import { serverApi, ApiError } from "@/lib/api/server";
import { Panel } from "@/components/dashboard/widgets";
import { FormDialog } from "@/components/ui/form-dialog";
import { AddLocationForm } from "@/components/dashboard/add-location-form";
import { EditLocationButton } from "@/components/dashboard/edit-location-button";
import { RemoveLocationButton } from "@/components/dashboard/remove-location-button";
import { LocationThumb } from "@/components/dashboard/location-photo";
import { matchesLocation } from "@/lib/search";
import type { ApiUser, Profile, Location, StockLevel } from "@/lib/api/types";
import { canManageInventory } from "@/lib/roles";

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const api = serverApi();
  // The topbar search narrows this list rather than leaving the page.
  const query = (await searchParams).q?.trim() ?? "";

  let profile: Profile | null = null;
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    profile = me.profile ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/session-ended");
    throw err;
  }

  let locations: Location[] = [];
  let stock: StockLevel[] = [];
  let loadError: string | null = null;
  try {
    [locations, stock] = await Promise.all([
      // P4: read-only lists — cache 60s.
      api.get<Location[]>("/locations", { revalidate: 60 }),
      api.get<StockLevel[]>("/stock", { revalidate: 60 }),
    ]);
  } catch (err) {
    loadError = err instanceof ApiError ? err.message : "Could not load locations.";
  }

  // Per-location summary: distinct items + total units.
  const summary = new Map<string, { items: Set<string>; units: number }>();
  for (const row of stock) {
    const s = summary.get(row.location_id) ?? { items: new Set<string>(), units: 0 };
    if (row.quantity > 0) s.items.add(row.item_id);
    s.units += row.quantity;
    summary.set(row.location_id, s);
  }

  // Warehouse rights, not "is an admin" — a stock manager has these too.
  const isAdmin = canManageInventory(profile);

  // Top-level locations and their sub-locations.
  const allTopLevel = locations.filter((l) => !l.parent_id);
  const childrenOf = new Map<string, Location[]>();
  for (const l of locations) {
    if (l.parent_id) {
      const arr = childrenOf.get(l.parent_id) ?? [];
      arr.push(l);
      childrenOf.set(l.parent_id, arr);
    }
  }

  // A parent stays listed when one of its sub-locations is the match — it is
  // the only way to reach the sub-location that was searched for.
  const topLevel = query
    ? allTopLevel.filter(
        (loc) =>
          matchesLocation(loc, query) ||
          (childrenOf.get(loc.id) ?? []).some((k) => matchesLocation(k, query)),
      )
    : allTopLevel;

  // Roll a location's own stock up with its sub-locations' stock.
  function rollup(loc: Location) {
    const items = new Set<string>();
    let units = 0;
    for (const id of [loc.id, ...(childrenOf.get(loc.id) ?? []).map((c) => c.id)]) {
      const s = summary.get(id);
      if (!s) continue;
      s.items.forEach((i) => items.add(i));
      units += s.units;
    }
    return { items: items.size, units };
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.75rem] text-foreground">Locations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a location to see its sub-locations (if any) and the items stored in it.
          </p>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/locations/labels"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <QrCode className="h-4 w-4" />
            Print box labels
          </Link>
          <FormDialog title="Add location" description="A top-level place. Sub-locations are added from its page." triggerLabel="Add location" size="md">
            <div className="p-5">
              <AddLocationForm />
            </div>
          </FormDialog>
          </div>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {loadError}
        </div>
      ) : null}

      {topLevel.length === 0 ? (
        <Panel title="Locations">
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {query ? `No location matches “${query}”.` : "No locations yet."}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topLevel.map((loc) => {
            const kids = childrenOf.get(loc.id) ?? [];
            const r = rollup(loc);
            return (
              <div
                key={loc.id}
                className="flex items-center gap-4 rounded-xl border border-line bg-card p-5"
              >
                {loc.photo_url || loc.has_photo ? (
                  <LocationThumb
                    url={loc.photo_url ?? null}
                    alt=""
                    locationId={loc.id}
                    hasPhoto={loc.has_photo}
                    size={72}
                  />
                ) : (
                  <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
                    <Warehouse className="h-7 w-7" />
                  </div>
                )}
                <Link href={`/locations/${loc.id}`} className="group min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-fg">{loc.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {kids.length > 0
                      ? `${kids.length} sub-location${kids.length === 1 ? "" : "s"} · ${r.units} units`
                      : `${r.items} items · ${r.units} units`}
                  </p>
                </Link>
                {isAdmin ? (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <EditLocationButton location={loc} />
                    <RemoveLocationButton id={loc.id} name={loc.name} />
                  </div>
                ) : (
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

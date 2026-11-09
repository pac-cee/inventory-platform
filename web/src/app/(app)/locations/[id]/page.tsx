import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  CornerDownRight,
  CornerLeftUp,
  GripVertical,
  QrCode,
} from "lucide-react";
import { serverApi, ApiError } from "@/lib/api/server";
import { fetchAllItems } from "@/lib/api/items";
import { Panel, StatusBadge } from "@/components/dashboard/widgets";
import { MoveToBoxButton } from "@/components/dashboard/move-to-box-button";
import {
  canHoldSubLocations,
  isOlderUntypedPlace,
  kindsAllowedUnder,
} from "@/lib/location-kind";
import { AddSubLocationForm } from "@/components/dashboard/add-sublocation-form";
import { EditLocationButton } from "@/components/dashboard/edit-location-button";
import { RemoveLocationButton } from "@/components/dashboard/remove-location-button";
import {
  DraggableItem,
  DropSubLocation,
  RelocateSelection,
  SelectionBar,
} from "@/components/dashboard/relocate-dnd";
import {
  LocationPhoto,
  LocationThumb,
} from "@/components/dashboard/location-photo";
import { ItemThumb } from "@/components/dashboard/item-photo";
import type {
  ApiUser,
  Profile,
  Location,
  StockLevel,
  Item,
} from "@/lib/api/types";
import { formatQuantity } from "@/lib/quantity";
import { bySlotThenName, slotLabel } from "@/lib/slots";
import { matchesItem, matchesLocation, noMatchMessage } from "@/lib/search";
import { canManageInventory } from "@/lib/roles";
import { kindBadge } from "@/lib/location-kind";

export default async function LocationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const api = serverApi();
  // The topbar search looks only inside this location — its sub-locations and
  // the items stored in it. Nothing here reaches the rest of the catalog.
  const query = (await searchParams).q?.trim() ?? "";

  let profile: Profile | null = null;
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>(
      "/auth/me",
    );
    profile = me.profile ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401)
      redirect("/session-ended");
    throw err;
  }
  // Warehouse rights, not "is an admin" — a stock manager has these too.
  const isAdmin = canManageInventory(profile);

  let location: Location;
  try {
    location = await api.get<Location>(`/locations/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const [allLocations, stock, items] = await Promise.all([
    api.get<Location[]>("/locations").catch(() => [] as Location[]),
    api.get<StockLevel[]>("/stock").catch(() => [] as StockLevel[]),
    // Every page of items: itemById below is what gives a row its thumbnail,
    // so an item missing from this map silently loses its photo.
    fetchAllItems(api).catch(() => [] as Item[]),
  ]);
  const itemById = new Map(items.map((it) => [it.id, it]));

  const children = allLocations.filter((l) => l.parent_id === id);
  // The boxes sitting on this place (a level): where its loose items can be put.
  const boxesHere = children
    .filter((c) => c.kind === "box")
    .map((c) => ({
      id: c.id,
      label: c.label?.trim() ? `${c.label.trim()} (${c.name})` : c.name,
    }));
  const parent = location.parent_id
    ? (allLocations.find((l) => l.id === location.parent_id) ?? null)
    : null;

  // Per-location summary for sub-location cards.
  const summary = new Map<string, { items: Set<string>; units: number }>();
  for (const row of stock) {
    const s = summary.get(row.location_id) ?? {
      items: new Set<string>(),
      units: 0,
    };
    if (row.quantity > 0) s.items.add(row.item_id);
    s.units += row.quantity;
    summary.set(row.location_id, s);
  }
  const summaryText = (locId: string) => {
    const s = summary.get(locId);
    return `${s?.items.size ?? 0} items · ${s?.units ?? 0} units`;
  };

  // Items stored directly in THIS location. Fully-emptied rows (nothing
  // accessible, damaged, or in the total — e.g. after everything was relocated
  // out) are dropped so an item doesn't linger as "0 / out of stock".
  const rows = stock
    .filter((s) => s.location_id === id)
    .filter((s) => s.quantity > 0 || s.capacity > 0 || (s.damaged ?? 0) > 0)
    // Ordered by the number people see on the shelf, so the list reads the way
    // the location does; anything unnumbered falls to the end.
    .sort((a, b) =>
      bySlotThenName(
        { slot_no: a.slot_no, name: a.items?.name },
        { slot_no: b.slot_no, name: b.items?.name },
      ),
    );
  const totalUnits = rows.reduce((sum, r) => sum + r.quantity, 0);

  const hasChildren = children.length > 0;

  // What the search leaves on screen. The unfiltered lists are kept for the
  // totals and the relocate targets, which describe the location itself and
  // must not change because someone is looking for one thing in it.
  const shownChildren = query
    ? children.filter((c) => matchesLocation(c, query))
    : children;
  const shownRows = query
    ? rows.filter((r) => {
        const it = itemById.get(r.item_id);
        return matchesItem(
          {
            type: r.items?.type,
            name: r.items?.name ?? "",
            model: r.items?.model,
            sku: r.items?.sku,
            specification: it?.specification,
          },
          query,
        );
      })
    : rows;
  const nothingMatches =
    Boolean(query) && shownChildren.length === 0 && shownRows.length === 0;

  // Where items here can be relocated to (admin only, in any direction):
  //  - this location's sub-locations (children)   → the "Sub-locations" panel
  //  - the parent and sibling locations           → the "Move to" panel
  const siblings = location.parent_id
    ? allLocations
        .filter(
          (l) => l.parent_id === location.parent_id && l.id !== location.id,
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const moveDestinations = [...(parent ? [parent] : []), ...siblings];
  const canRelocate =
    isAdmin && rows.length > 0 && children.length + moveDestinations.length > 0;

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <Link
        href={parent ? `/locations/${parent.id}` : "/locations"}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        {parent ? parent.name : "All locations"}
      </Link>

      <div className="detail-header">
        <div>
          <h1 className="font-serif text-[1.75rem] text-foreground">
            {location.name}
            {location.archived_at ? (
              <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                (removed)
              </span>
            ) : null}
          </h1>
          {kindBadge(location.kind, location.label) ? (
            <p className="mt-1 inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {kindBadge(location.kind, location.label)}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-muted-foreground">
            {hasChildren
              ? `${children.length} sub-location${children.length === 1 ? "" : "s"}`
              : `${rows.length} item${rows.length === 1 ? "" : "s"} · ${totalUnits} units`}
          </p>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-1">
            {location.kind === "box" && location.qr_token ? (
              <Link
                href={`/locations/labels?only=${location.id}`}
                title="Print this box's label"
                aria-label="Print this box's label"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <QrCode className="h-4 w-4" />
              </Link>
            ) : null}
            <EditLocationButton
              location={location}
              parentKind={parent?.kind ?? null}
            />
            <RemoveLocationButton
              id={location.id}
              name={location.name}
              redirectTo={parent ? `/locations/${parent.id}` : "/locations"}
            />
          </div>
        ) : null}
      </div>

      {/* This place's own picture — shown only when there is one, so a location
          without a photo looks exactly as it did before. */}
      {location.photo_url || location.has_photo ? (
        <Panel title="Photo">
          <LocationPhoto
            url={location.photo_url ?? null}
            alt={location.name}
            locationId={location.id}
            hasPhoto={location.has_photo}
          />
        </Panel>
      ) : null}

      {isAdmin && isOlderUntypedPlace(location.kind, parent?.kind) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/40 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            <span className="font-medium text-fg">Set what this place is.</span>{" "}
            It was made before places had types, so it is treated as an area.
            Choose its type (
            {parent
              ? kindsAllowedUnder(parent.kind).join(" / ") || "area"
              : "area"}
            ) so the right things can be added inside it.
          </p>
          <EditLocationButton
            location={location}
            parentKind={parent?.kind ?? null}
          />
        </div>
      ) : null}

      {isAdmin &&
      canHoldSubLocations(location.kind) &&
      !isOlderUntypedPlace(location.kind, parent?.kind) ? (
        <details className="rounded-2xl border border-border bg-card">
          <summary className="cursor-pointer rounded-2xl px-5 py-4 text-[13px] font-medium outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
            Add {kindsAllowedUnder(location.kind)[0]}
          </summary>
          <div className="p-5">
            <AddSubLocationForm
              parentId={location.id}
              parentKind={location.kind ?? "area"}
            />
          </div>
        </details>
      ) : null}

      {/* Sub-locations, the "move to" targets and the item rows share one
          selection: ticking items here lets a single drag move the whole batch.
          The provider renders no DOM of its own, so the layout is unchanged. */}
      <RelocateSelection>
        {hasChildren && shownChildren.length > 0 ? (
          <Panel
            title="Sub-locations"
            action={
              query ? (
                <span className="text-xs text-muted-foreground">
                  {shownChildren.length} of {children.length}
                </span>
              ) : canRelocate ? (
                <span className="text-xs text-muted-foreground">
                  Drag items here to move them
                </span>
              ) : undefined
            }
          >
            <ul className="divide-y divide-line">
              {shownChildren
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((sub) => {
                  const rowInner = (
                    <div className="flex items-center gap-3 px-5 py-4">
                      <CornerDownRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <LocationThumb
                        url={sub.photo_url ?? null}
                        alt=""
                        locationId={sub.id}
                        hasPhoto={sub.has_photo}
                        size={40}
                      />
                      <Link
                        href={`/locations/${sub.id}`}
                        className="group min-w-0 flex-1"
                      >
                        <p className="truncate text-sm font-medium text-fg">
                          {sub.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {summaryText(sub.id)}
                        </p>
                      </Link>
                      {isAdmin ? (
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <EditLocationButton
                            location={sub}
                            parentKind={location.kind ?? "area"}
                          />
                          <RemoveLocationButton id={sub.id} name={sub.name} />
                        </div>
                      ) : (
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}
                    </div>
                  );
                  return (
                    <li key={sub.id}>
                      {canRelocate ? (
                        <DropSubLocation
                          fromLocationId={location.id}
                          toLocationId={sub.id}
                        >
                          {rowInner}
                        </DropSubLocation>
                      ) : (
                        rowInner
                      )}
                    </li>
                  );
                })}
            </ul>
          </Panel>
        ) : null}

        {/* Move to the parent or a sibling location — drop targets that aren't
          otherwise on this page, so items can go up a level or across to a
          neighbour (not just down into a sub-location). Admin only. */}
        {isAdmin && rows.length > 0 && moveDestinations.length > 0 ? (
          <Panel
            title="Move to another location"
            action={
              <span className="text-xs text-muted-foreground">
                Drag items here
              </span>
            }
          >
            <ul className="divide-y divide-line">
              {moveDestinations.map((dest) => {
                const isParent = !!parent && dest.id === parent.id;
                return (
                  <li key={dest.id}>
                    <DropSubLocation
                      fromLocationId={location.id}
                      toLocationId={dest.id}
                    >
                      <div className="flex items-center gap-3 px-5 py-3">
                        {isParent ? (
                          <CornerLeftUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        ) : (
                          <CornerDownRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        )}
                        <Link
                          href={`/locations/${dest.id}`}
                          className="min-w-0 flex-1"
                        >
                          <p className="truncate text-sm font-medium text-fg">
                            {dest.name}
                            {isParent ? (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                · up one level
                              </span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {summaryText(dest.id)}
                          </p>
                        </Link>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      </div>
                    </DropSubLocation>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        {/* Items directly here — the main view for a leaf location, and a fallback
          if a parent location also has items stocked directly in it. */}
        {(!hasChildren || rows.length > 0) && shownRows.length > 0 ? (
          <Panel
            title={hasChildren ? "Items directly here" : "Items here"}
            action={
              query ? (
                <span className="text-xs text-muted-foreground">
                  {shownRows.length} of {rows.length}
                </span>
              ) : canRelocate ? (
                <SelectionBar total={rows.length} />
              ) : undefined
            }
          >
            {shownRows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                {hasChildren
                  ? "No items directly in this location — open a sub-location above."
                  : "No items stored in this location yet."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {shownRows.map((row) => {
                  const it = itemById.get(row.item_id);
                  const link = (
                    <Link
                      href={`/items/${row.item_id}?at=${location.id}`}
                      draggable={canRelocate ? false : undefined}
                      className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-surface-2/40"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {canRelocate ? (
                          <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        ) : null}
                        {/* The item's number in THIS location — what people point
                          at on the shelf. Counts from 1 per location. */}
                        <span className="w-7 flex-shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                          {slotLabel(row.slot_no)}
                        </span>
                        <ItemThumb
                          url={it?.photo_url ?? null}
                          alt=""
                          itemId={it?.id}
                          hasPhoto={it?.has_photo}
                          size={40}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fg">
                            {row.items?.type ?? row.item_id}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.items?.name} ·{" "}
                            <span className="font-mono">{row.items?.sku}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {it ? formatQuantity(it, row.quantity) : row.quantity}
                        </span>
                        <StatusBadge quantity={row.quantity} />
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  );
                  const row_ = canRelocate ? (
                    <DraggableItem itemId={row.item_id}>{link}</DraggableItem>
                  ) : (
                    link
                  );
                  return (
                    <li key={row.item_id}>
                      {/* The boxes on this level: put some of the item into one. */}
                      {canRelocate &&
                      boxesHere.length > 0 &&
                      row.quantity > 0 ? (
                        <div className="flex items-center gap-2 pr-4">
                          <div className="min-w-0 flex-1">{row_}</div>
                          <MoveToBoxButton
                            itemId={row.item_id}
                            itemName={
                              row.items?.name ?? row.items?.type ?? "item"
                            }
                            fromLocationId={location.id}
                            available={row.quantity}
                            boxes={boxesHere}
                          />
                        </div>
                      ) : (
                        row_
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        ) : null}

        {/* Searching from inside a location never leaves it, so when the query
          hits nothing we say what was actually searched rather than showing
          empty panels. */}
        {nothingMatches ? (
          <Panel title="No matches">
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {noMatchMessage("location", query)}
            </p>
          </Panel>
        ) : null}
      </RelocateSelection>
    </div>
  );
}

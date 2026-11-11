import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, User } from "lucide-react";
import { serverApi, ApiError } from "@/lib/api/server";
import { Panel, StatusBadge } from "@/components/dashboard/widgets";
import { MovementForm } from "@/components/dashboard/movement-form";
import { StockAdjustForm } from "@/components/dashboard/stock-adjust-form";
import { AddItemLocationForm } from "@/components/dashboard/add-item-location-form";
import { MoveStockForm } from "@/components/dashboard/move-stock-form";
import { FinishableToggle } from "@/components/dashboard/finishable-toggle";
import { EditItemForm } from "@/components/dashboard/edit-item-form";
import { DeleteItemButton } from "@/components/dashboard/delete-item-button";
import { ItemQrCard } from "@/components/dashboard/item-qr-card";
import { ItemPhoto } from "@/components/dashboard/item-photo";
import { PanelTabs } from "@/components/dashboard/panel-tabs";
import { ActivityLog } from "@/components/dashboard/activity-log";
import { SuggestionsPanel } from "@/components/dashboard/suggestions-panel";
import type {
  ApiUser,
  Profile,
  Item,
  Location,
  Movement,
  StockLevel,
  Holder,
  Suggestion,
  Loan,
  Reservation,
  Department,
} from "@/lib/api/types";
import { formatQuantity, isPackaged } from "@/lib/quantity";
import { canManageInventory } from "@/lib/roles";
import { ExtendLoanButton } from "@/components/dashboard/extend-loan-button";
import { dueLabel } from "@/lib/return-by";
import { ReservationsPanel } from "@/components/dashboard/reservations-panel";

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ at?: string }>;
}) {
  const { id } = await params;
  // Opened from a box (a scan, or a click inside it): take from THAT box by default.
  const { at } = await searchParams;
  const api = serverApi();

  let profile: Profile | null = null;
  let userId = "";
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>(
      "/auth/me",
    );
    profile = me.profile ?? null;
    userId = me.user.id;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401)
      redirect("/session-ended");
    throw err;
  }

  let item: Item;
  try {
    item = await api.get<Item>(`/items/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const [
    stock,
    movements,
    profiles,
    locations,
    holders,
    allStock,
    categories,
    departments,
    suggestions,
    loans,
    reservations,
  ] = await Promise.all([
    api.get<StockLevel[]>(`/items/${id}/stock`).catch(() => [] as StockLevel[]),
    api
      .get<Movement[]>(`/movements?item_id=${id}`)
      .catch(() => [] as Movement[]),
    api.get<Profile[]>("/profiles").catch(() => [] as Profile[]),
    api.get<Location[]>("/locations").catch(() => [] as Location[]),
    api.get<Holder[]>(`/items/${id}/holders`).catch(() => [] as Holder[]),
    api.get<StockLevel[]>("/stock").catch(() => [] as StockLevel[]),
    api.get<string[]>("/reports/categories").catch(() => [] as string[]),
    api.get<Department[]>("/departments").catch(() => null),
    api
      .get<Suggestion[]>(`/suggestions?item_id=${id}`)
      .catch(() => [] as Suggestion[]),
    api
      .get<Loan[]>(`/movements/borrowed?item_id=${id}`)
      .catch(() => [] as Loan[]),
    api
      .get<Reservation[]>(`/reservations?item_id=${id}`)
      .catch(() => [] as Reservation[]),
  ]);

  // Rooms that hold items directly aren't leaves, so a leaf-only picker hid
  // them. Knowing which locations hold anything lets those be offered too.
  const occupiedLocationIds = [...new Set(allStock.map((s) => s.location_id))];

  const totalQty = stock.reduce((sum, r) => sum + r.quantity, 0);
  const totalCap = stock.reduce((sum, r) => sum + (r.capacity ?? 0), 0);
  const totalDamaged = stock.reduce((sum, r) => sum + (r.damaged ?? 0), 0);
  const totalHeld = holders.reduce((sum, h) => sum + h.quantity, 0);
  // Every unit is accessible, damaged, or in someone's hands, so these must add
  // up to the total. A leftover means units were double-counted somewhere — say
  // so rather than printing a breakdown that visibly doesn't sum.
  const unaccounted = totalCap - (totalQty + totalDamaged + totalHeld);

  // Everyone the admin can attribute damage/loss to — all users, current holders
  // first (with their held count), so they can point to whoever did it.
  const heldBy = new Map(holders.map((h) => [h.user_id, h.quantity]));
  const people = profiles
    .map((p) => ({
      user_id: p.id,
      full_name: p.full_name ?? "",
      quantity: heldBy.get(p.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.quantity - a.quantity || a.full_name.localeCompare(b.full_name),
    );
  // Who a manager may record a take/return FOR: accounts that can actually hold
  // things (not blocked, not awaiting approval), the ones holding this item first.
  const activeIds = new Set(
    profiles
      .filter(
        (p) => !p.blocked && (p.approval_status ?? "approved") === "approved",
      )
      .map((p) => p.id),
  );
  const behalfPeople = people.filter((p) => activeIds.has(p.user_id));
  // A finish/destroyed entry can be undone once; track which are already reversed.
  const reversedIds = new Set(
    movements.map((m) => m.reversal_of).filter(Boolean) as string[],
  );

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <Link
        href="/search"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Inventory
      </Link>

      <div className="detail-header">
        <div>
          <h1 className="font-serif text-[1.75rem] text-foreground">
            {item.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.type} · {item.model}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{item.sku}</span>
            {item.specification ? ` · ${item.specification}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums text-fg">
              {totalQty}
            </p>
            <p className="text-xs text-muted-foreground">
              {isPackaged(item)
                ? `${item.package_label}${totalQty === 1 ? "" : "s"} in stock`
                : "in stock"}
            </p>
          </div>
          <StatusBadge quantity={totalQty} capacity={totalCap} />
        </div>
      </div>

      <dl className="detail-summary" aria-label="Item stock summary">
        <div>
          <dt>Available</dt>
          <dd>{totalQty}</dd>
        </div>
        <div>
          <dt>With people</dt>
          <dd>{totalHeld}</dd>
        </div>
        <div>
          <dt>Damaged</dt>
          <dd className={totalDamaged ? "text-warning" : ""}>{totalDamaged}</dd>
        </div>
      </dl>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Panel title="Where it is">
            {stock.length === 0 && holders.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Not stored anywhere yet.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {stock.map((row) => {
                  // Container-aware display: when the item is packed (units_per_container > 1)
                  // and this location has a container label, show accessible units as containers too.
                  const isContainer =
                    !!row.container_label && item.units_per_container > 1;
                  const accContainers = isContainer
                    ? row.quantity / item.units_per_container
                    : row.quantity;
                  return (
                    <div
                      key={row.location_id}
                      className="flex items-center justify-between px-5 py-3"
                    >
                      <span className="flex items-center gap-2 text-sm text-fg">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {row.locations?.name ?? row.location_id}
                        {row.slot_no ? (
                          <span
                            className="rounded bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground"
                            title="This item's number in that location"
                          >
                            #{row.slot_no}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2 text-sm tabular-nums">
                        <span className="text-muted-foreground">
                          {isPackaged(item) ? (
                            <span className="text-fg font-medium">
                              {formatQuantity(item, row.quantity)}
                            </span>
                          ) : isContainer ? (
                            <>
                              <span className="text-fg font-medium">
                                {accContainers} {row.container_label}
                                {accContainers === 1 ? "" : "s"}
                              </span>{" "}
                              ({row.quantity} accessible)
                            </>
                          ) : (
                            <>{row.quantity} accessible</>
                          )}
                        </span>
                        {row.damaged > 0 ? (
                          <span className="text-amber-500">
                            · {row.damaged} damaged
                          </span>
                        ) : null}
                        {row.capacity ? (
                          <span className="text-muted-foreground/60">
                            / {row.capacity}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}

                {holders.length > 0 ? (
                  <div className="px-5 py-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Currently held by
                    </p>
                    <ul className="space-y-1.5">
                      {holders.map((h) => (
                        <li key={h.user_id} className="text-sm">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-fg">
                              <User className="h-4 w-4 text-muted-foreground" />
                              {h.full_name || "Unknown"}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {h.quantity}
                            </span>
                          </div>
                          {/* When each lot is due back — overdue ones stand out. */}
                          <ul className="mt-1 space-y-1 pl-6">
                            {loans
                              .filter((l) => l.user_id === h.user_id)
                              .map((l) => {
                                const due = dueLabel(l);
                                return (
                                  <li
                                    key={l.take_id}
                                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                  >
                                    <span
                                      className={
                                        due.tone === "bad"
                                          ? "font-medium text-destructive"
                                          : due.tone === "warn"
                                            ? "font-medium text-amber-600 dark:text-amber-400"
                                            : "text-muted-foreground"
                                      }
                                    >
                                      {l.quantity} · {due.text}
                                    </span>
                                    {l.user_id === userId ||
                                    canManageInventory(profile) ? (
                                      <ExtendLoanButton
                                        itemId={item.id}
                                        takeId={l.take_id}
                                      />
                                    ) : null}
                                  </li>
                                );
                              })}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="px-5 py-3 text-xs text-muted-foreground">
                  {isPackaged(item) ? (
                    <>
                      Total{" "}
                      <span className="font-medium text-fg">
                        {formatQuantity(item, totalCap)}
                      </span>
                    </>
                  ) : (
                    <>
                      Total{" "}
                      <span className="font-medium text-fg">{totalCap}</span> ={" "}
                      {totalQty} accessible
                      {totalDamaged > 0 ? (
                        <>
                          {" "}
                          ·{" "}
                          <span className="text-amber-500">
                            {totalDamaged} damaged
                          </span>
                        </>
                      ) : null}
                      {totalHeld > 0 ? ` · ${totalHeld} with people` : null}
                      {unaccounted !== 0 ? (
                        <>
                          {" "}
                          ·{" "}
                          <span className="text-destructive">
                            {Math.abs(unaccounted)} unaccounted
                          </span>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
                {unaccounted !== 0 ? (
                  <p className="px-5 pb-3 text-xs text-muted-foreground">
                    The parts don&apos;t add up to the total. That happens when
                    units were returned to a different location before the total
                    followed them — fix it with{" "}
                    <strong>Edit stock numbers</strong>.
                  </p>
                ) : null}
              </div>
            )}
          </Panel>

          {item.specification ? (
            <Panel title="Specification">
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-fg">
                {item.specification}
              </p>
            </Panel>
          ) : null}

          <details className="rounded-2xl border border-border bg-card">
            <summary className="cursor-pointer rounded-2xl px-5 py-4 text-[13px] font-medium outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
              Photo & QR code
            </summary>
            <div className="space-y-4 p-4">
              <Panel title="Photo">
                {/* Display only — the photo is set from Edit item, alongside the
              other properties, rather than from two places at once. */}
                <ItemPhoto
                  url={item.photo_url}
                  alt={item.name}
                  itemId={item.id}
                  hasPhoto={item.has_photo}
                />
              </Panel>
              <Panel title="QR code">
                <ItemQrCard itemId={item.id} sku={item.sku} name={item.type} />
              </Panel>
            </div>
          </details>
        </div>
        <PanelTabs
          defaultTab="movement"
          tabs={[
            {
              id: "movement",
              label: "Take or return",
              content: (
                <MovementForm
                  itemId={item.id}
                  locations={locations}
                  stock={stock}
                  finishable={item.finishable}
                  isAdmin={canManageInventory(profile)}
                  holders={people}
                  behalfPeople={canManageInventory(profile) ? behalfPeople : []}
                  defaultLocationId={at}
                />
              ),
            },
            {
              id: "reserve",
              label: "Reserve",
              content: (
                <ReservationsPanel
                  itemId={item.id}
                  locations={locations}
                  stock={stock}
                  reservations={reservations}
                  currentUserId={userId}
                  isManager={canManageInventory(profile)}
                  behalfPeople={canManageInventory(profile) ? behalfPeople : []}
                />
              ),
            },
          ]}
        />
      </div>

      {/* One row of buttons instead of a stack of cards — the whole set is
          visible at a glance and only the one you ask for renders. */}
      <PanelTabs
        defaultTab="activity"
        tabs={[
          {
            id: "suggestions",
            label: "Suggested changes",
            summary: suggestions.length
              ? `${suggestions.length} open`
              : "none open",
            content: (
              <SuggestionsPanel
                itemId={item.id}
                suggestions={suggestions}
                locations={locations.filter((l) =>
                  stock.some((r) => r.location_id === l.id),
                )}
                isAdmin={canManageInventory(profile)}
                currentUserId={userId}
              />
            ),
          },
          {
            id: "activity",
            label: "Activity",
            summary: movements.length
              ? `${movements.length} entries`
              : "nothing yet",
            content: (
              <ActivityLog
                movements={movements}
                itemId={item.id}
                userId={userId}
                isAdmin={canManageInventory(profile)}
                nameById={Object.fromEntries(
                  profiles.map((p) => [p.id, p.full_name ?? ""]),
                )}
                reversedIds={[...reversedIds]}
              />
            ),
          },
          ...(canManageInventory(profile)
            ? [
                {
                  id: "edit",
                  label: "Edit details",
                  summary: "name, SKU, spec, photo",
                  content: (
                    <EditItemForm
                      item={item}
                      containerLabel={
                        stock.find((s) => s.container_label)?.container_label ??
                        null
                      }
                      categories={categories}
                      departments={departments}
                    />
                  ),
                },
                {
                  id: "locations",
                  label: "Locations",
                  summary: "move, or add another",
                  content: (
                    // Moving conserves the grand total; correcting changes it.
                    // Sharing a tab, still separate forms.
                    <div className="divide-y divide-border">
                      <div>
                        <p className="px-5 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Move between locations
                        </p>
                        <MoveStockForm
                          itemId={item.id}
                          locations={locations}
                          stock={stock}
                          occupiedLocationIds={occupiedLocationIds}
                        />
                      </div>
                      <div>
                        <p className="px-5 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Add to another location
                        </p>
                        <AddItemLocationForm
                          itemId={item.id}
                          locations={locations}
                          stock={stock}
                          occupiedLocationIds={occupiedLocationIds}
                        />
                      </div>
                    </div>
                  ),
                },
                {
                  id: "settings",
                  label: "Stock & settings",
                  summary: "counts, finishable, delete",
                  content: (
                    <div className="divide-y divide-border">
                      <StockAdjustForm itemId={item.id} stock={stock} />
                      <FinishableToggle
                        itemId={item.id}
                        finishable={item.finishable}
                      />
                      <div className="flex items-center justify-between gap-4 px-5 py-5">
                        <div>
                          <p className="text-sm font-medium text-fg">
                            Delete this item
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Removes it from the catalog and all its stock.
                          </p>
                        </div>
                        <DeleteItemButton id={item.id} name={item.name} />
                      </div>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

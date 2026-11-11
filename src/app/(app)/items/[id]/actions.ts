"use server";

import { revalidatePath } from "next/cache";
import { serverApi, ApiError } from "@/lib/api/server";
import type { Fault } from "@/lib/api/types";
import { itemPages } from "@/lib/revalidate";

/** Movements that change stock for an item, from the item detail screen. */
export type StockAction = "take" | "return" | "finish" | "destroy" | "lost" | "repair";

const ENDPOINT: Record<StockAction, string> = {
  take: "/movements/check-out",
  return: "/movements/check-in",
  finish: "/movements/finish",
  destroy: "/movements/destroy",
  lost: "/movements/lost",
  repair: "/movements/repair",
};

function revalidateItem(itemId: string): void {
  // `/items` was missing here: a photo uploaded from the detail page refreshed
  // the dashboard but not the catalog list, which then served its cached render
  // for a further 60 seconds.
  for (const path of itemPages(itemId)) revalidatePath(path);
}

/** Extras that only apply to some actions. */
export interface MovementDetails {
  /** Damage/loss: attribute it to whoever is holding the units. */
  damagedBy?: string;
  /** Damage/loss: what is wrong. Required by the API — the condition report
   *  tallies these, so unexplained damage would print as a blank. */
  note?: string;
  /** Damage/loss: what should be done about it. */
  recommendation?: string;
  /** Repair: which recorded fault this fixes, so the condition report's
   *  sentence loses the right clause rather than an arbitrary one. */
  resolves?: string;
  /** Take: when the person expects to bring it back (ISO). Omitted = no fixed date. */
  expectedReturnAt?: string;
  /** Take/return, managers only: record it for this person instead of yourself. */
  onBehalfOf?: string;
}

/**
 * Record a stock movement for an item. `take`/`return` move stock the usual way;
 * `finish`/`destroy` permanently consume it (quantity and total both drop).
 * Available to any authenticated user; RLS records it under their own id, which
 * is how the activity log knows "who did what".
 */
export async function recordMovement(
  itemId: string,
  locationId: string,
  quantity: number,
  action: StockAction,
  details: MovementDetails = {},
): Promise<{ error?: string }> {
  const api = serverApi();
  const damageOrLoss = action === "destroy" || action === "lost";
  try {
    await api.post(ENDPOINT[action], {
      item_id: itemId,
      location_id: locationId,
      quantity,
      ...(damageOrLoss && details.damagedBy ? { damaged_by: details.damagedBy } : {}),
      ...(damageOrLoss && details.note ? { note: details.note } : {}),
      ...(damageOrLoss && details.recommendation
        ? { recommendation: details.recommendation }
        : {}),
      ...(action === "repair" && details.resolves ? { resolves: details.resolves } : {}),
      ...(action === "take" && details.expectedReturnAt ? { expected_return_at: details.expectedReturnAt } : {}),
      ...((action === "take" || action === "return") && details.onBehalfOf ? { on_behalf_of: details.onBehalfOf } : {}),
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not record movement." };
  }
  revalidateItem(itemId);
  return {};
}

/** Reserve units of an item at a location for a window of dates. */
export async function reserveItem(
  itemId: string,
  r: { locationId: string; quantity: number; startsAt: string; endsAt: string; note?: string; forUserId?: string },
): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.post("/reservations", {
      item_id: itemId,
      location_id: r.locationId,
      quantity: r.quantity,
      starts_at: r.startsAt,
      ends_at: r.endsAt,
      ...(r.note ? { note: r.note } : {}),
      ...(r.forUserId ? { for_user_id: r.forUserId } : {}),
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not reserve." };
  }
  revalidateItem(itemId);
  return {};
}

/** Withdraw a reservation (the person it is for, whoever booked it, or a manager). */
export async function cancelReservation(itemId: string, reservationId: string): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.post(`/reservations/${reservationId}/cancel`);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not cancel." };
  }
  revalidateItem(itemId);
  return {};
}

/** Change when a loan is due back (the holder, or a manager). */
export async function extendLoan(
  itemId: string,
  takeId: string,
  expectedReturnAt: string,
): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.post(`/movements/${takeId}/extend`, { expected_return_at: expectedReturnAt });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not change the return date." };
  }
  revalidateItem(itemId);
  return {};
}

/**
 * The outstanding faults for an item at a location — what is currently wrong
 * with the damaged units. Feeds the repair dialog's "which one did you fix?".
 */
export async function listFaults(
  itemId: string,
  locationId: string,
): Promise<{ faults?: Fault[]; error?: string }> {
  try {
    const faults = await serverApi().get<Fault[]>(
      `/movements/faults?item_id=${itemId}&location_id=${locationId}`,
    );
    return { faults };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not load the faults." };
  }
}

/** Admin: set an item's current quantity and/or total at a location directly. */
export async function adjustStock(
  itemId: string,
  locationId: string,
  quantity: number,
  capacity: number,
): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.post("/movements/adjust", {
      item_id: itemId,
      location_id: locationId,
      quantity,
      capacity,
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not update stock." };
  }
  revalidateItem(itemId);
  return {};
}

/**
 * Admin: move a given number of units of one item from one location to
 * another. Only units on the shelf move — damaged units and anything checked
 * out stay where they are. The total travels with them, so the item's grand
 * total is unchanged; use "Edit stock numbers" to actually add or remove units.
 *
 * Leave `quantity` undefined to move the item's whole presence (what dragging a
 * row on the location page does).
 */
export async function moveStockBetween(
  itemId: string,
  fromLocationId: string,
  toLocationId: string,
  quantity?: number,
): Promise<{ error?: string }> {
  if (!fromLocationId || !toLocationId) return { error: "Choose both locations." };
  if (fromLocationId === toLocationId) return { error: "Choose two different locations." };
  if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) {
    return { error: "Enter how many to move (at least 1)." };
  }
  const api = serverApi();
  try {
    await api.post("/movements/transfer", {
      item_id: itemId,
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      ...(quantity !== undefined ? { quantity } : {}),
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not move the stock." };
  }
  revalidateItem(itemId);
  revalidatePath(`/locations/${fromLocationId}`);
  revalidatePath(`/locations/${toLocationId}`);
  revalidatePath("/");
  return {};
}

/** Undo a finish/destroyed movement (own entry, or any as admin). */
export async function undoMovement(
  movementId: string,
  itemId: string,
): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.post(`/movements/${movementId}/undo`);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not undo." };
  }
  revalidateItem(itemId);
  return {};
}

/** Admin: toggle whether an item can be finished. */
export async function setFinishable(
  itemId: string,
  finishable: boolean,
): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.patch(`/items/${itemId}`, { finishable });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not update item." };
  }
  revalidatePath(`/items/${itemId}`);
  return {};
}

export interface EditItemState {
  ok?: boolean;
  error?: string;
}

/**
 * Admin: edit an item's core details (type, name, model, specification) and how it is
 * counted. `id` is bound by the caller. Name is required; SKU and specification
 * can be cleared by leaving them blank.
 *
 * The counting mode goes to a separate endpoint because it spans two tables
 * (the item's units-per-container / package label, and the container label on
 * every location that stocks it) and the three modes are mutually exclusive.
 * Converting to containers never changes a recorded quantity — stock is held in
 * units either way, the display just groups them.
 */
export async function editItem(
  id: string,
  _prev: EditItemState,
  formData: FormData,
): Promise<EditItemState> {
  const api = serverApi();
  const type = String(formData.get("type") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const specification = String(formData.get("specification") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  // Present only when the form shows the picker; "none" clears it.
  const department = formData.get("department_id");
  // Blank clears the photo; the API takes null, not "".
  const photoUrl = String(formData.get("photo_url") ?? "").trim();
  // An uploaded file wins; only one of the two is ever filled.
  const photoData = String(formData.get("photo_data") ?? "").trim();
  // Set when the user moved to a link or cleared the file — the stored upload
  // has to go, or it keeps winning and the new link is never seen.
  const clearPhotoData = String(formData.get("photo_data_clear") ?? "") === "1";
  const mode = String(formData.get("mode") ?? "units");

  if (!type) return { error: "Item type is required." };
  if (!name) return { error: "Name is required." };
  if (!model) return { error: "Model is required." };

  let packaging: Record<string, unknown> | null = null;
  if (mode === "container") {
    const unitsPerContainer = Number(formData.get("units_per_container"));
    const containerLabel = String(formData.get("container_label") ?? "").trim();
    if (!Number.isFinite(unitsPerContainer) || unitsPerContainer < 2) {
      return { error: "A container has to hold at least 2 units." };
    }
    if (!containerLabel) return { error: "Give the container a label (e.g. box)." };
    packaging = {
      mode,
      units_per_container: unitsPerContainer,
      container_label: containerLabel,
    };
  } else if (mode === "package") {
    const packageLabel = String(formData.get("package_label") ?? "").trim();
    if (!packageLabel) return { error: "Give the package a label (e.g. package)." };
    packaging = { mode, package_label: packageLabel };
  } else {
    packaging = { mode: "units" };
  }

  try {
    await api.patch(`/items/${id}`, {
      type,
      name,
      model,
      // No `sku` — reassigned by the API when the type changes.
      specification: specification || null,
      category: category || null,
      ...(typeof department === "string" ? { department_id: department === "none" || !department ? null : department } : {}),
      photo_url: photoUrl || null,
      ...(photoData
        ? { photo_data: photoData }
        : clearPhotoData
          ? { photo_data: null }
          : {}),
    });
    await api.patch(`/items/${id}/packaging`, packaging);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not update item." };
  }
  revalidateItem(id);
  revalidatePath("/items");
  revalidatePath("/locations");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Admin: stock an EXISTING item at another location, without re-creating the
 * item. Seeds initial stock there (same as the create flow does for the first
 * location). Use when the same item lives in more than one place.
 */
export async function stockAtLocation(
  itemId: string,
  locationId: string,
  quantity: number,
): Promise<{ error?: string }> {
  if (!locationId) return { error: "Choose a location." };
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "Enter a starting quantity of at least 1." };
  }
  const api = serverApi();
  try {
    await api.post("/movements", {
      item_id: itemId,
      location_id: locationId,
      delta: quantity,
      reason: "initial",
      note: "Initial stock",
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not stock at that location." };
  }
  revalidateItem(itemId);
  return {};
}

/**
 * Store an uploaded photo. `dataUrl` is produced by the browser after it has
 * resized the file, so what arrives here is already small.
 */
export async function uploadItemPhoto(
  itemId: string,
  dataUrl: string,
): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.put(`/items/${itemId}/photo`, { data_url: dataUrl });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not save that photo." };
  }
  revalidateItem(itemId);
  return {};
}

/** Remove an uploaded photo. Any photo_url link on the item is left alone. */
export async function removeItemPhoto(itemId: string): Promise<{ error?: string }> {
  const api = serverApi();
  try {
    await api.del(`/items/${itemId}/photo`);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not remove that photo." };
  }
  revalidateItem(itemId);
  return {};
}

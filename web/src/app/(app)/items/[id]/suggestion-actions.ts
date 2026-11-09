"use server";

import { revalidatePath } from "next/cache";
import { serverApi, ApiError } from "@/lib/api/server";
import type { Suggestion } from "@/lib/api/types";

function revalidateItem(itemId: string): void {
  revalidatePath(`/items/${itemId}`);
  revalidatePath("/reports");
}

/** Open suggestions for an item. */
export async function listSuggestions(itemId: string): Promise<Suggestion[]> {
  try {
    return await serverApi().get<Suggestion[]>(`/suggestions?item_id=${itemId}`);
  } catch {
    return [];
  }
}

export type SuggestionState = { error?: string; ok?: boolean };

/** Raise a suggestion. Any signed-in user. */
export async function addSuggestion(
  itemId: string,
  _prev: SuggestionState,
  formData: FormData,
): Promise<SuggestionState> {
  const note = String(formData.get("note") ?? "").trim();
  const kind = String(formData.get("kind") ?? "upgrade");
  const rawUnits = String(formData.get("units") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();

  if (note.length < 3) return { error: "Say what should be done." };

  try {
    await serverApi().post("/suggestions", {
      item_id: itemId,
      note,
      kind,
      // Blank means the item generally, at every location.
      location_id: locationId || null,
      units: rawUnits ? Number(rawUnits) : null,
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not save that suggestion." };
  }
  revalidateItem(itemId);
  return { ok: true };
}

/** Close a suggestion — done, or decided against. Admin only. */
export async function resolveSuggestion(
  itemId: string,
  id: string,
  resolution: string,
): Promise<{ error?: string }> {
  try {
    await serverApi().post(`/suggestions/${id}/resolve`, {
      resolution: resolution.trim() || undefined,
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not close that suggestion." };
  }
  revalidateItem(itemId);
  return {};
}

/** Withdraw a suggestion. The author, or an admin. */
export async function removeSuggestion(
  itemId: string,
  id: string,
): Promise<{ error?: string }> {
  try {
    await serverApi().del(`/suggestions/${id}`);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not remove that suggestion." };
  }
  revalidateItem(itemId);
  return {};
}

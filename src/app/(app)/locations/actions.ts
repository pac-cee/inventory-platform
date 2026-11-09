"use server";

import { revalidatePath } from "next/cache";
import { serverApi, ApiError } from "@/lib/api/server";

/**
 * Relocate one or several items' stock from one location to another
 * (admin-only) — e.g. dragging items that sit directly in a room into a
 * sub-location.
 *
 * Always moves each item's ENTIRE presence at the source (accessible, damaged
 * and the full total, including units currently checked out), leaving the source
 * empty. That's deliberate: moving exactly the source's own total is what keeps
 * the item's grand total unchanged and heals legacy under-counted rows. There is
 * no partial move.
 *
 * A batch is best-effort per item: if some move and some don't, the ones that
 * did are kept and the failures come back as a message naming how many didn't.
 */
export async function relocateStock(
  itemIds: string | string[],
  fromLocationId: string,
  toLocationId: string,
): Promise<{ error?: string; moved?: number }> {
  const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
  if (ids.length === 0) return { moved: 0 };

  const api = serverApi();
  let moved = ids.length;
  let partial: string | undefined;
  try {
    if (ids.length === 1) {
      await api.post("/movements/transfer", {
        item_id: ids[0],
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
      });
    } else {
      const res = await api.post<{ moved: number; failed: { message: string }[] }>(
        "/movements/transfer",
        {
          item_ids: ids,
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
        },
      );
      moved = res.moved;
      if (res.failed?.length) {
        partial = `Moved ${res.moved} of ${ids.length}. ${res.failed.length} could not be moved: ${res.failed[0].message}`;
      }
    }
  } catch (err) {
    return {
      error:
        err instanceof ApiError
          ? err.message
          : ids.length === 1
            ? "Could not relocate the item."
            : "Could not relocate the items.",
    };
  }
  revalidatePath(`/locations/${fromLocationId}`);
  revalidatePath(`/locations/${toLocationId}`);
  revalidatePath("/");
  return partial ? { error: partial, moved } : { moved };
}

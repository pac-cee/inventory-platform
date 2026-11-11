"use server";

import { revalidatePath } from "next/cache";
import { serverApi, ApiError } from "@/lib/api/server";
import type { ApiUser, Desk, Profile } from "@/lib/api/types";
import { canManageInventory } from "@/lib/roles";
import { clampPlacement } from "@/lib/spatial/model";
import { DESKS } from "@/lib/spatial/verlet-site";

export interface DeskChange {
  /** The floor plan's desk id. */
  id: string;
  x: number;
  z: number;
  rotation: number;
  /** Who sits there; only a manager may change this. Leave out to keep it. */
  user_id?: string | null;
}

/**
 * Save where desks stand and who sits at them, for everyone.
 *
 * A person may move and turn their own desk. Admins and stock managers may
 * move any desk and say whose it is. Anything else is refused here, not just
 * hidden on the map.
 */
export async function saveDesks(changes: DeskChange[]): Promise<{ saved: number; error?: string }> {
  const api = serverApi();
  let user: ApiUser;
  let profile: Profile | null;
  let current: Desk[];
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    user = me.user;
    profile = me.profile;
    current = await api.get<Desk[]>("/desks");
  } catch (err) {
    return { saved: 0, error: err instanceof ApiError ? err.message : "Could not save the desks." };
  }
  const manager = canManageInventory(profile);
  const known = new Set(DESKS.map((d) => d.id));
  let saved = 0;
  try {
    for (const change of changes.slice(0, DESKS.length)) {
      if (!known.has(change.id)) continue;
      const owner = current.find((d) => d.id === change.id)?.user_id ?? null;
      if (!manager && owner !== user.id)
        return { saved, error: "You can only move your own desk." };
      const place = clampPlacement({ x: Number(change.x), z: Number(change.z), rotation: Number(change.rotation) }, true);
      if (![place.x, place.z, place.rotation].every(Number.isFinite)) continue;
      await api.put<Desk>(`/desks/${change.id}`, {
        ...place,
        ...(manager && change.user_id !== undefined ? { user_id: change.user_id } : {}),
      });
      saved++;
    }
  } catch (err) {
    return { saved, error: err instanceof ApiError ? err.message : "Could not save the desks." };
  }
  revalidatePath("/space");
  return { saved };
}

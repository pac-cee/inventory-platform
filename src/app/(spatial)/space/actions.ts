"use server";

import { revalidatePath } from "next/cache";
import { serverApi, ApiError } from "@/lib/api/server";
import type { ApiUser, Desk, Profile } from "@/lib/api/types";
import { canManageInventory } from "@/lib/roles";
import { clampPlacement } from "@/lib/spatial/model";
import { applyPlan, sanitizePlan, type FloorPlan } from "@/lib/spatial/verlet-site";

type Api = ReturnType<typeof serverApi>;
async function whoAmI(api: Api): Promise<{ user: ApiUser; manager: boolean }> {
  const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
  return { user: me.user, manager: canManageInventory(me.profile) };
}
const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Save the room for everyone: its size, door, furniture and where the shelves
 * stand. Only an admin or stock manager may. Passing null puts the default
 * plan back.
 */
export async function saveFloorPlan(plan: FloorPlan | null): Promise<{ plan?: FloorPlan; error?: string }> {
  const api = serverApi();
  try {
    if (!(await whoAmI(api)).manager) return { error: "Only an admin or stock manager can change the room." };
    if (plan === null) {
      await api.del("/floor-plan");
      revalidatePath("/space");
      return { plan: applyPlan(null) };
    }
    const clean = sanitizePlan(plan);
    if (!clean) return { error: "That is not a floor plan." };
    await api.put("/floor-plan", { ...clean });
    revalidatePath("/space");
    return { plan: clean };
  } catch (err) {
    return { error: message(err, "Could not save the room.") };
  }
}

export interface DeskChange {
  /** The floor plan's desk id. */
  id: string;
  /** Where it now stands; leave out to keep its place. */
  x?: number;
  z?: number;
  rotation?: number;
  /** Who sits there; only a manager may change this. Leave out to keep it. */
  user_id?: string | null;
}

/**
 * Save where desks stand and who sits at them, for everyone.
 *
 * A person may move and turn their own desk. Admins and stock managers may
 * move any desk and say whose it is. Anything else is refused here, not just
 * hidden on the map. A desk's place is written into the shared floor plan.
 */
export async function saveDesks(changes: DeskChange[]): Promise<{ saved: number; error?: string }> {
  const api = serverApi();
  let saved = 0;
  try {
    const { user, manager } = await whoAmI(api);
    const [owners, stored] = await Promise.all([api.get<Desk[]>("/desks"), api.get<unknown>("/floor-plan")]);
    // The live plan decides which desks exist and where the walls are.
    const plan = applyPlan(stored);
    let moved = false;
    for (const change of changes.slice(0, 400)) {
      const piece = plan.pieces.find((p) => p.id === change.id && p.kind === "workstation");
      if (!piece) continue;
      const owner = owners.find((d) => d.id === change.id)?.user_id ?? null;
      if (!manager && owner !== user.id) return { saved, error: "You can only move your own desk." };
      if ([change.x, change.z, change.rotation].every((n) => typeof n === "number" && Number.isFinite(n))) {
        const place = clampPlacement({ x: change.x!, z: change.z!, rotation: change.rotation! }, "workstation");
        Object.assign(piece, { x: place.x, z: place.z, rot: (place.rotation * Math.PI) / 180 });
        moved = true;
      }
      if (manager && change.user_id !== undefined) await api.put<Desk>(`/desks/${change.id}`, { user_id: change.user_id });
      saved++;
    }
    if (moved) await api.put("/floor-plan", { ...plan });
  } catch (err) {
    return { saved, error: message(err, "Could not save the desks.") };
  }
  revalidatePath("/space");
  return { saved };
}

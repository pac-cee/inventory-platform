import Link from "next/link";
import { redirect } from "next/navigation";
import { serverApi, ApiError } from "@/lib/api/server";
import { fetchAllItems } from "@/lib/api/items";
import type {
  ApiUser,
  Profile,
  Item,
  Location,
  StockLevel,
  Desk,
} from "@/lib/api/types";
import type { SpatialShelf } from "@/lib/spatial/model";
import { canManageInventory } from "@/lib/roles";
import { SpatialWorkspace } from "@/components/spatial/workspace";
import { applyPlan, isKnownLocation, locationHome } from "@/lib/spatial/verlet-site";

export default async function SpacePage() {
  const api = serverApi();
  let user: ApiUser;
  let profile: Profile | null = null;
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>(
      "/auth/me",
    );
    user = me.user;
    profile = me.profile;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect("/session-ended");
    throw error;
  }
  let data: [Location[], Item[], StockLevel[]] | null = null;
  try {
    data = await Promise.all([
      api.get<Location[]>("/locations"),
      fetchAllItems(api),
      api.get<StockLevel[]>("/stock"),
    ]);
  } catch {
    /* Keep unavailable stock distinct from empty shelves. */
  }
  if (!data)
    return (
      <div className="grid min-h-dvh place-items-center">
        <div>
          <h1 className="font-serif text-3xl">Office inventory</h1>
          <p className="mt-3 text-muted-foreground">
            Inventory could not be loaded. Refresh to try again.
          </p>
          <Link href="/" className="mt-5 block underline">
            Back home
          </Link>
        </div>
      </div>
    );
  const [locations, items, stock] = data;
  // The room: the plan someone saved, or the default. `stored` is undefined
  // when the API has no floor plan at all; the room can then not be edited.
  const [stored, owners, people] = await Promise.all([
    api.get<unknown>("/floor-plan").catch(() => undefined),
    api.get<Desk[]>("/desks").catch(() => null),
    api.get<Profile[]>("/profiles").catch(() => [] as Profile[]),
  ]);
  const plan = applyPlan(stored);
  const editable = stored !== undefined && owners !== null;
  const manager = canManageInventory(profile);
  const byId = new Map(items.map((item) => [item.id, item]));
  // Each location stands where the plan puts it; locations the plan does not
  // name take the next spare spot.
  let spare = 0;
  const shelves: SpatialShelf[] = locations.map((location) => ({
    id: location.id,
    name: location.name,
    ...locationHome(
      location.name,
      isKnownLocation(location.name) ? 0 : spare++,
    ),
    items: stock
      .filter((row) => row.location_id === location.id)
      .map((row) => ({
        id: row.item_id,
        name: byId.get(row.item_id)?.name ?? "Item",
        type: byId.get(row.item_id)?.type ?? "",
        quantity: row.quantity,
        capacity: row.capacity,
      })),
  }));
  return (
    <SpatialWorkspace
      shelves={shelves}
      plan={plan}
      canEditRoom={editable && manager}
      canMoveDesks={editable}
      deskOwners={Object.fromEntries((owners ?? []).map((d) => [d.id, d.user_id]))}
      people={people.filter((p) => !p.blocked).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "Unnamed" }))}
      userId={user.id}
      profile={profile}
      catalog={items.map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type,
        quantity: 0,
        capacity: 0,
      }))}
    />
  );
}

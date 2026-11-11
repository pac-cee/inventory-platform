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
import { DESK_PREFIX, clampPlacement, type SpatialShelf } from "@/lib/spatial/model";
import { canManageInventory } from "@/lib/roles";
import { SpatialWorkspace } from "@/components/spatial/workspace";
import { DESKS, isKnownLocation, locationHome } from "@/lib/spatial/verlet-site";

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
  const byId = new Map(items.map((item) => [item.id, item]));
  // Each location stands where its furniture is on Verlet's floor; locations
  // the floor plan doesn't know take the next spare spot.
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
  // Desks: where each stands and who sits there. null when the API has no
  // desks yet; they are then part of the room and cannot be moved.
  const [saved, people] = await Promise.all([
    api.get<Desk[]>("/desks").catch(() => null),
    api.get<Profile[]>("/profiles").catch(() => [] as Profile[]),
  ]);
  const manager = canManageInventory(profile);
  const nameOf = new Map(people.map((p) => [p.id, p.full_name ?? p.email ?? "Unnamed"]));
  const desks: SpatialShelf[] = DESKS.map((home) => {
    const row = saved?.find((d) => d.id === home.id);
    const owner = row?.user_id ?? null;
    const placed = row && row.x !== null && row.z !== null && row.rotation !== null;
    return {
      id: `${DESK_PREFIX}${home.id}`,
      kind: "desk" as const,
      name: home.name,
      ...(placed
        ? clampPlacement({ x: row.x!, z: row.z!, rotation: row.rotation! }, true)
        : { x: home.x, z: home.z, rotation: home.rotation }),
      owner,
      ownerName: owner ? (nameOf.get(owner) ?? (owner === user.id ? "You" : "Someone")) : null,
      mine: owner === user.id,
      locked: !saved || !(manager || owner === user.id),
      items: [],
    };
  });
  return (
    <SpatialWorkspace
      shelves={shelves}
      desks={desks}
      people={manager && saved ? people.filter((p) => !p.blocked).map((p) => ({ id: p.id, name: p.full_name ?? p.email ?? "Unnamed" })) : []}
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

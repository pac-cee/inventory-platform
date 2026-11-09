import { redirect } from "next/navigation";
import { serverApi, ApiError } from "@/lib/api/server";
import type { ApiUser, Location, Profile } from "@/lib/api/types";
import { BoxLabelSheet, type BoxLabel } from "@/components/dashboard/box-label-sheet";
import { locationLabel } from "@/lib/locations";
import { canManageInventory } from "@/lib/roles";

/**
 * Printable QR stickers for boxes. Managers only: the code on a sticker is what
 * lets anyone open that box, and handing them out is a warehouse decision.
 * `?only=<id>[,<id>]` prints just those boxes (the "Print label" link on a box).
 */
export default async function BoxLabelsPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const { only } = await searchParams;
  const api = serverApi();

  let profile: Profile | null = null;
  let locations: Location[] = [];
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    profile = me.profile ?? null;
    if (!canManageInventory(profile)) redirect("/locations");
    locations = await api.get<Location[]>("/locations");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/session-ended");
    throw err;
  }

  const wanted = only ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const labels: BoxLabel[] = locations
    .filter((l) => l.kind === "box" && l.qr_token && (!wanted || wanted.has(l.id)))
    .map((l) => ({
      id: l.id,
      token: l.qr_token!,
      title: l.label || l.name,
      path: locationLabel(l, locations),
    }))
    // In the order a person walks the shelves.
    .sort((a, b) => a.path.localeCompare(b.path));

  return <BoxLabelSheet labels={labels} backHref={wanted && labels.length === 1 ? `/locations/${labels[0].id}` : "/locations"} startSelected={!!wanted} />;
}

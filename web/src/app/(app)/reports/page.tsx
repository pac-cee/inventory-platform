import { redirect } from "next/navigation";
import { serverApi, ApiError } from "@/lib/api/server";
import { fetchAllItems } from "@/lib/api/items";
import { ReportsTabs } from "@/components/dashboard/reports-tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ApiUser, Profile, Item, Location } from "@/lib/api/types";
import { canManageInventory } from "@/lib/roles";

/**
 * Admin reports. Both are reads over data we already keep, so nothing here is
 * stored or precomputed:
 *
 *   Activity  — the movement ledger, filtered by time, location (incl. nested
 *               sub-locations), item, activity type and person.
 *   Condition — current state per item and location: quantity, a tally of what
 *               is wrong with the damaged units, % operational, and the fixes
 *               recorded against those faults.
 *
 * Both offer print / CSV export.
 */
export default async function ReportsPage() {
  const api = serverApi();

  let profile: Profile | null = null;
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    profile = me.profile;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/session-ended");
    throw err;
  }
  // Warehouse screen: a stock manager belongs here too, not just an admin.
  if (!canManageInventory(profile)) redirect("/");

  let items: Item[] = [];
  let locations: Location[] = [];
  let profiles: Profile[] = [];
  let categories: string[] = [];
  let loadError: string | null = null;
  try {
    [items, locations, profiles, categories] = await Promise.all([
      // Every page, or a report silently covers only part of the catalog.
      fetchAllItems(api),
      api.get<Location[]>("/locations"),
      api.get<Profile[]>("/profiles"),
      api.get<string[]>("/reports/categories"),
    ]);
  } catch (err) {
    loadError = err instanceof ApiError ? err.message : "Could not load filter options.";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="print:hidden">
        <h1 className="font-serif text-[1.75rem] text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What happened to your stock, and what state it is in now.
        </p>
      </div>

      {loadError ? (
        <Alert variant="warning">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <ReportsTabs
        locations={locations}
        items={items}
        profiles={profiles}
        categories={categories}
        preparedBy={profile?.full_name ?? null}
        showPayments={profile?.role === "admin"}
      />
    </div>
  );
}

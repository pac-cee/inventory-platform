import { redirect } from "next/navigation";
import { serverApi, ApiError } from "@/lib/api/server";
import type { ActivityReport, ApiUser, Loan, Profile, ReportRow } from "@/lib/api/types";
import { EquipmentAudit } from "@/components/dashboard/equipment-audit";
import { canManageInventory } from "@/lib/roles";
import { FEED_REASONS } from "@/lib/activity-feed";

/**
 * Who is holding what, for managers: every outstanding loan with filters and
 * per-person totals. Members see their own loans on the item page and the bell.
 */
export default async function EquipmentPage() {
  const api = serverApi();

  let profile: Profile | null = null;
  let loans: Loan[] = [];
  let loadError: string | null = null;
  let recent: ReportRow[] = [];
  let recentError: string | null = null;
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    profile = me.profile ?? null;
    if (!canManageInventory(profile)) redirect("/");
    try {
      loans = await api.get<Loan[]>("/movements/borrowed");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw err;
      loadError = "Could not load borrowed equipment. Try refreshing.";
    }
    // Who took, returned or damaged what in the last 30 days. A separate try so
    // one failing does not blank the other.
    try {
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const report = await api.get<ActivityReport>(
        `/movements/report?from=${encodeURIComponent(from)}&reason=${FEED_REASONS.join(",")}&limit=300`,
      );
      recent = report.rows;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw err;
      recentError = "Could not load recent activity. Try refreshing.";
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/session-ended");
    throw err;
  }

  return <EquipmentAudit loans={loans} loadError={loadError} recent={recent} recentError={recentError} />;
}

"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityReport } from "@/components/dashboard/activity-report";
import { ConditionReport } from "@/components/dashboard/condition-report";
import { PaymentsDetailedReport } from "@/components/dashboard/payments-detailed-report";
import type { Item, Location, Profile } from "@/lib/api/types";

/**
 * The reports index. Three different questions, so three reports:
 *
 *   Activity  — what HAPPENED (the ledger over time: who took what, when)
 *   Condition — what STATE things are in right now (the printed asset table)
 *   Payments  — what was BOUGHT (the corporate expense audit trail)
 *
 * Tabs rather than separate routes so the filters of whichever one you are
 * working in survive glancing at the other.
 */
export function ReportsTabs({
  locations,
  items,
  profiles,
  categories,
  preparedBy,
  showPayments = true,
}: {
  locations: Location[];
  items: Item[];
  profiles: Profile[];
  categories: string[];
  /** Signed-in person, printed on the PDF as its author. */
  preparedBy: string | null;
  /** The payments audit is admin-only; managers get the two inventory reports. */
  showPayments?: boolean;
}) {
  return (
    <Tabs defaultValue="activity" className="space-y-4">
      {/* Printing should produce the report, not the navigation. */}
      <TabsList className="print:hidden">
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="condition">Condition</TabsTrigger>
        {showPayments ? <TabsTrigger value="payments">Payments</TabsTrigger> : null}
      </TabsList>

      <TabsContent value="activity">
        <p className="mb-4 text-sm text-muted-foreground print:hidden">
          Everything that happened to your stock — filter by time, location, item, activity, or
          person.
        </p>
        <ActivityReport locations={locations} items={items} profiles={profiles} />
      </TabsContent>

      <TabsContent value="condition">
        <p className="mb-4 text-sm text-muted-foreground print:hidden">
          What state everything is in right now, by room and category — quantity, condition, %
          operational and what to do about it.
        </p>
        <ConditionReport
          locations={locations}
          categories={categories}
          preparedBy={preparedBy}
        />
      </TabsContent>

      {showPayments ? (
      <TabsContent value="payments">
        <p className="mb-4 text-sm text-muted-foreground print:hidden">
          Corporate expense transactions — filter by person, item (name or SKU), or date, and
          export a signed-off audit trail.
        </p>
        <PaymentsDetailedReport profiles={profiles} preparedBy={preparedBy} />
      </TabsContent>
      ) : null}
    </Tabs>
  );
}

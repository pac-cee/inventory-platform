import type { ConditionRow } from "@/lib/api/types";

// Shared by the on-screen table, the CSV and the PDF so all three read the same.

/**
 * The Condition cell, in the words the printed report uses.
 *
 * Nothing wrong   -> "Good"
 * A mix           -> "9 good, 12 batteries died, 1 Broken screen"
 *
 * Damage recorded before reasons were required has no fault behind it, so it is
 * called out as unexplained rather than folded into the good count.
 */
export function conditionText(r: ConditionRow): string {
  const parts: string[] = [];
  if (r.damaged === 0) return "Good";
  if (r.operational > 0) parts.push(`${r.operational} good`);
  for (const f of r.faults) parts.push(`${f.units} ${f.note}`);
  const unexplained = r.damaged - r.accounted;
  if (unexplained > 0) parts.push(`${unexplained} out of service (reason not recorded)`);
  return parts.join(", ");
}

/** The distinct fixes recommended across this row's outstanding faults. */
export function recommendationText(r: ConditionRow): string {
  const seen = new Set<string>();
  for (const f of r.faults) if (f.recommendation) seen.add(f.recommendation);
  return [...seen].join("; ");
}

/** Operational share of the total owned, to one decimal place. */
export function percent(r: ConditionRow): number {
  if (r.total <= 0) return 0;
  return Math.round((r.operational / r.total) * 1000) / 10;
}

/** What distinguishes two variants of the same item — em dash when there is none. */
export function specificationText(r: ConditionRow): string {
  return r.specification?.trim() || "—";
}

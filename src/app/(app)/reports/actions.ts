"use server";

import { serverApi, ApiError } from "@/lib/api/server";
import type { ActivityReport, ConditionRow } from "@/lib/api/types";

/** Filters for the activity report — all optional and composable. */
export interface ReportFilters {
  from?: string; // ISO datetime (inclusive)
  to?: string; // ISO datetime (inclusive)
  location_id?: string;
  item_id?: string;
  user_id?: string;
  person_field?: "attributed" | "actor";
  reason?: string[]; // activity types
  include_undone?: boolean;
}

export interface ReportResult {
  report?: ActivityReport;
  error?: string;
}

/** Run the admin activity report. Returns enriched rows + summary rollups. */
export async function runReport(filters: ReportFilters): Promise<ReportResult> {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.location_id) params.set("location_id", filters.location_id);
  if (filters.item_id) params.set("item_id", filters.item_id);
  if (filters.user_id) {
    params.set("user_id", filters.user_id);
    params.set("person_field", filters.person_field ?? "attributed");
  }
  if (filters.reason?.length) params.set("reason", filters.reason.join(","));
  if (filters.include_undone) params.set("include_undone", "true");

  try {
    const report = await serverApi().get<ActivityReport>(`/movements/report?${params.toString()}`);
    return { report };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not run the report." };
  }
}

/** Filters for the condition report. */
export interface ConditionFilters {
  /** A room or shelf — includes everything nested under it. */
  location_id?: string;
  category?: string;
  /** Only rows with damaged units — the "what needs attention" view. */
  faulty_only?: boolean;
}

export interface ConditionResult {
  rows?: ConditionRow[];
  error?: string;
}

/**
 * Run the condition report — the printed asset-state table (room, category,
 * item, quantity, condition, % operational, recommendation).
 */
export async function runConditionReport(filters: ConditionFilters): Promise<ConditionResult> {
  const params = new URLSearchParams();
  if (filters.location_id) params.set("location_id", filters.location_id);
  if (filters.category) params.set("category", filters.category);
  if (filters.faulty_only) params.set("faulty_only", "true");

  try {
    const rows = await serverApi().get<ConditionRow[]>(`/reports/condition?${params.toString()}`);
    return { rows };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not run the report." };
  }
}

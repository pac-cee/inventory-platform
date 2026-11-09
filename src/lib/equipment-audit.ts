import type { Loan } from "@/lib/api/types";

/**
 * The manager's audit of borrowed equipment: who holds what, narrowed by status
 * or a typed name, with totals per person. Kept free of React so the rules can be
 * tested directly.
 */
export type StatusFilter = "all" | "overdue" | "due_today" | "upcoming" | "none";

export interface AuditSummary {
  loans: number;
  units: number;
  people: number;
  overdue: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Loans matching the status and any typed text (person, item or place). Order is kept. */
export function filterLoans(loans: Loan[], status: StatusFilter, query: string): Loan[] {
  const q = norm(query);
  return loans.filter((l) => {
    if (status !== "all" && l.status !== status) return false;
    if (!q) return true;
    return [l.user_name, l.item_name, l.location_name].some((t) => norm(t ?? "").includes(q));
  });
}

export function summarize(loans: Loan[]): AuditSummary {
  return {
    loans: loans.length,
    units: loans.reduce((n, l) => n + l.quantity, 0),
    people: new Set(loans.map((l) => l.user_id)).size,
    overdue: loans.filter((l) => l.status === "overdue").length,
  };
}

export interface PersonGroup {
  user_id: string;
  user_name: string;
  units: number;
  overdue: number;
  /** The most days late among this person's loans (0 when none are late). */
  worstDaysOverdue: number;
  loans: Loan[];
}

/** One group per person; the people with the most overdue (then the latest) come first. */
export function groupByPerson(loans: Loan[]): PersonGroup[] {
  const by = new Map<string, PersonGroup>();
  for (const l of loans) {
    let g = by.get(l.user_id);
    if (!g) {
      g = { user_id: l.user_id, user_name: l.user_name || "Unknown", units: 0, overdue: 0, worstDaysOverdue: 0, loans: [] };
      by.set(l.user_id, g);
    }
    g.units += l.quantity;
    g.loans.push(l);
    if (l.status === "overdue") {
      g.overdue += 1;
      g.worstDaysOverdue = Math.max(g.worstDaysOverdue, l.days_overdue);
    }
  }
  return [...by.values()].sort(
    (a, b) => b.overdue - a.overdue || b.worstDaysOverdue - a.worstDaysOverdue || a.user_name.localeCompare(b.user_name),
  );
}

/** CSV of the (filtered) loans, for handing to someone outside the app. */
export function loansToCsv(loans: Loan[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Person", "Item", "Quantity", "Location", "Taken", "Due", "Status", "Days overdue"];
  const lines = loans.map((l) =>
    [l.user_name, l.item_name, l.quantity, l.location_name, l.taken_at.slice(0, 10), l.expected_return_at?.slice(0, 10) ?? "", l.status, l.days_overdue]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

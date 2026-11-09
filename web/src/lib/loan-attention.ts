import type { Loan } from "@/lib/api/types";

/**
 * Which of someone's loans deserve a nudge in the bell: anything late, due today,
 * or due tomorrow. Anything further out, and open-ended loans, stay quiet — a bell
 * that always has something in it gets ignored.
 */
export function loansNeedingAttention(loans: Loan[], now: Date = new Date()): Loan[] {
  const TZ = "Africa/Kigali";
  const dayNumber = (d: Date) => {
    const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(d)
      .split("-")
      .map(Number);
    return Date.UTC(y, m - 1, day) / 86_400_000;
  };
  return loans
    .filter((l) => {
      if (l.status === "overdue" || l.status === "due_today") return true;
      if (l.status === "upcoming" && l.expected_return_at) {
        return dayNumber(new Date(l.expected_return_at)) - dayNumber(now) === 1;
      }
      return false;
    })
    // Most urgent first: overdue (latest first), then due today, then tomorrow.
    .sort((a, b) => {
      const rank = (l: Loan) => (l.status === "overdue" ? 0 : l.status === "due_today" ? 1 : 2);
      return rank(a) - rank(b) || b.days_overdue - a.days_overdue || a.item_name.localeCompare(b.item_name);
    });
}

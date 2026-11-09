/**
 * "How long will you use it?" — turning the choice on the Take form into the
 * date the API stores, and turning a stored date back into words.
 *
 * A date means the END of that day (23:59 local): "back by Friday" is fine at
 * any time on Friday, and a loan is not overdue until the day is over.
 */
export type ReturnBy = "none" | "today" | "tomorrow" | "week" | "month" | "custom";

export const RETURN_BY_OPTIONS: { value: ReturnBy; label: string }[] = [
  { value: "none", label: "No fixed date" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "In 1 week" },
  { value: "month", label: "In 1 month" },
  { value: "custom", label: "Pick a date…" },
];

const endOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 0, 0);

/** The ISO timestamp to send, or an error to show. `iso` is null for "no fixed date". */
export function returnByIso(
  choice: ReturnBy,
  customDate = "",
  now: Date = new Date(),
): { iso: string | null; error?: string } {
  if (choice === "none") return { iso: null };

  let when: Date;
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (choice === "today") when = endOfDay(y, m, d);
  else if (choice === "tomorrow") when = endOfDay(y, m, d + 1);
  else if (choice === "week") when = endOfDay(y, m, d + 7);
  else if (choice === "month") when = endOfDay(y, m + 1, d);
  else {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(customDate);
    if (!match) return { iso: null, error: "Pick the date you will bring it back." };
    when = endOfDay(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    // new Date rolls 31 Feb over to March; a date that changed is not the date they picked.
    if (when.getMonth() !== Number(match[2]) - 1) return { iso: null, error: "That is not a real date." };
  }
  if (when.getTime() <= now.getTime()) return { iso: null, error: "That date has already passed." };
  return { iso: when.toISOString() };
}

export interface LoanLike {
  status: "none" | "upcoming" | "due_today" | "overdue";
  expected_return_at: string | null;
  days_overdue: number;
}

const TZ = "Africa/Kigali";
const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });

/** What to print next to a loan, and how loudly. */
export function dueLabel(loan: LoanLike): { text: string; tone: "muted" | "warn" | "bad" } {
  switch (loan.status) {
    case "none":
      return { text: "No fixed return date", tone: "muted" };
    case "due_today":
      return { text: "Due today", tone: "warn" };
    case "overdue": {
      const n = loan.days_overdue;
      return { text: n <= 0 ? "Overdue" : `Overdue · ${n} day${n === 1 ? "" : "s"}`, tone: "bad" };
    }
    default:
      return { text: `Due ${fmt.format(new Date(loan.expected_return_at!))}`, tone: "muted" };
  }
}

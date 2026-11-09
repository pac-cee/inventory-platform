/**
 * Loans: who is holding what, since when, and when it is due back.
 *
 * What a person holds is the running total of their ledger rows (HELD_EXPR), but
 * that total alone cannot say WHICH take a still-held unit came from — and the
 * due date belongs to the take. So returns (and damage/loss) are matched against
 * the OLDEST takes first (FIFO): if you took 2 on Monday due Friday and 3 on
 * Wednesday due next week, then return 2, the Friday loan is cleared and the 3
 * you still hold keep next week's date.
 *
 * Pure: the ledger rows go in, the outstanding loans come out. The SQL that
 * fetches the rows lives with the routes; this is the part with the rules.
 */

export interface LedgerRow {
  id: string;
  item_id: string;
  user_id: string;
  location_id: string;
  reason: string;
  created_at: Date | string;
  /** This row's HELD_EXPR contribution (negative = units released). */
  contrib: number;
  /** Due date of this row if it is a take that has one. */
  expected_return_at: Date | string | null;
}

export interface OutstandingLoan {
  take_id: string;
  item_id: string;
  user_id: string;
  location_id: string;
  quantity: number;
  taken_at: Date;
  expected_return_at: Date | null;
}

const asDate = (d: Date | string | null): Date | null => (d === null ? null : d instanceof Date ? d : new Date(d));

export function outstandingLoans(rows: LedgerRow[]): OutstandingLoan[] {
  // One independent queue per (item, person).
  const queues = new Map<string, OutstandingLoan[]>();
  const sorted = [...rows].sort(
    (a, b) =>
      asDate(a.created_at)!.getTime() - asDate(b.created_at)!.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  for (const r of sorted) {
    if (r.contrib === 0) continue;
    const key = `${r.item_id}|${r.user_id}`;
    let queue = queues.get(key);
    if (!queue) queues.set(key, (queue = []));

    if (r.contrib > 0) {
      // A take — or something that handed units back to the holder (an undo of a
      // return). Only a real take carries a due date.
      queue.push({
        take_id: r.id,
        item_id: r.item_id,
        user_id: r.user_id,
        location_id: r.location_id,
        quantity: r.contrib,
        taken_at: asDate(r.created_at)!,
        expected_return_at: r.reason === "take" ? asDate(r.expected_return_at) : null,
      });
    } else {
      // Units released: clear the oldest loans first.
      let release = -r.contrib;
      while (release > 0 && queue.length > 0) {
        const oldest = queue[0];
        const used = Math.min(oldest.quantity, release);
        oldest.quantity -= used;
        release -= used;
        if (oldest.quantity === 0) queue.shift();
      }
    }
  }

  return [...queues.values()].flat();
}

export type DueStatus = "none" | "upcoming" | "due_today" | "overdue";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a loan stands against `now`. "Due today" is the calendar day in `tz`
 * (default Africa/Kigali, where the team works): a loan due at 17:00 is not
 * overdue at 09:00, and is still "due today" until that day ends.
 */
export function dueStatus(expected: Date | null, now: Date = new Date(), tz = "Africa/Kigali"): DueStatus {
  if (!expected) return "none";
  if (expected.getTime() < now.getTime()) return "overdue";
  return localDay(expected, tz) === localDay(now, tz) ? "due_today" : "upcoming";
}

/** Whole days late, counted in calendar days in `tz`; 0 when not late. */
export function daysOverdue(expected: Date | null, now: Date = new Date(), tz = "Africa/Kigali"): number {
  if (!expected || expected.getTime() >= now.getTime()) return 0;
  const diff = Math.round((dayNumber(now, tz) - dayNumber(expected, tz)));
  return Math.max(diff, 0);
}

function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function dayNumber(d: Date, tz: string): number {
  const [y, m, day] = localDay(d, tz).split("-").map(Number);
  return Date.UTC(y, m - 1, day) / DAY_MS;
}

/** The latest a return date may be set: a year out. */
export const MAX_LOAN_DAYS = 366;

/** Returns an error message when `d` is not an acceptable due date, else null. */
export function checkDueDate(d: Date, now: Date = new Date()): string | null {
  if (Number.isNaN(d.getTime())) return "That is not a valid date.";
  if (d.getTime() <= now.getTime()) return "The return date has to be in the future.";
  if (d.getTime() > now.getTime() + MAX_LOAN_DAYS * DAY_MS) return "The return date can be at most a year away.";
  return null;
}

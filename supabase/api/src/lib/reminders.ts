/**
 * When to remind someone about a loan.
 *
 * The schedule: the day before it is due, the day it is due, then — once it is
 * late — a day after, and every 3 days from there (1, 4, 7, 10 … days overdue).
 * Each step is its own `kind`, so the job can run any number of times a day and
 * every step still goes out exactly once.
 *
 * Pure. The loan's status and day counts come from lib/loans.ts, in Kigali days.
 */
import { daysOverdue, dueStatus } from "./loans.js";

const TZ = "Africa/Kigali";
/** Reminders go out from this hour (Kigali) onwards — not in the small hours. */
export const REMINDER_HOUR = 8;
/** Once late: first reminder after this many days, then every OVERDUE_EVERY days. */
export const OVERDUE_EVERY = 3;

export type ReminderKind = "due_tomorrow" | "due_today" | `overdue_${number}`;

const dayNumber = (d: Date): number => {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, day) / 86_400_000;
};

/** Which reminder (if any) is due for a loan today. Null for open-ended loans and quiet days. */
export function reminderFor(expected: Date | null, now: Date = new Date()): ReminderKind | null {
  if (!expected) return null;
  const status = dueStatus(expected, now, TZ);
  if (status === "due_today") return "due_today";
  if (status === "upcoming") {
    return dayNumber(expected) - dayNumber(now) === 1 ? "due_tomorrow" : null;
  }
  if (status === "overdue") {
    const days = daysOverdue(expected, now, TZ);
    // 1, 4, 7, 10 … : the day after it was due, then every OVERDUE_EVERY days.
    return days >= 1 && (days - 1) % OVERDUE_EVERY === 0 ? `overdue_${days}` : null;
  }
  return null;
}

/** Is it a sensible time to send? From 08:00 Kigali on, so a restart at 03:00 does not wake anyone. */
export function isReminderTime(now: Date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now));
  return hour >= REMINDER_HOUR;
}

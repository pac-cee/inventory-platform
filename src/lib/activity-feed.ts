import type { ReportRow } from "@/lib/api/types";

/**
 * "Who took what, recently": activity-report rows as a day-by-day feed. The same
 * wording and grouping rules as the phone app (mobile/lib/activity_feed.dart), so
 * both read alike. Kept free of React so it can be tested directly.
 */

/** The activity types worth a feed: stock going out, coming back, or damaged. */
export const FEED_REASONS = ["take", "return", "destroyed"] as const;

/** "Cable · USB-A to C · 1m": type, then the name if it says more, then the model. */
export function feedItemLabel(r: ReportRow): string {
  const parts = [r.item.type];
  if (r.item.name && r.item.name !== "—" && r.item.name !== r.item.type) parts.push(r.item.name);
  if (r.item.model && r.item.model !== "Unspecified") parts.push(r.item.model);
  return parts.join(" · ");
}

/** One line: "Amina took 2 × Cable". Says so when someone else recorded it. */
export function feedSentence(r: ReportRow): string {
  const who = r.person.name?.trim() || "Someone";
  const item = feedItemLabel(r);
  const n = r.units;
  let core: string;
  switch (r.reason) {
    case "take":
      core = `${who} took ${n} × ${item}`;
      break;
    case "return":
      core = `${who} returned ${n} × ${item}`;
      break;
    case "destroyed":
      core = `${n} × ${item} damaged (${who === "Someone" ? "unattributed" : who})`;
      break;
    default:
      core = `${r.label || r.reason} · ${item}`;
  }
  const actor = r.actor.name?.trim();
  const byOther = !!actor && !!r.actor.id && r.actor.id !== r.person.id;
  return byOther ? `${core} (recorded by ${actor})` : core;
}

const TZ_OFFSET_MS = 2 * 3_600_000; // Kigali is UTC+2 all year, whatever the browser's zone says.
const kigali = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS);

/** "10:42" in Kigali time. */
export function feedTime(iso: string): string {
  const k = kigali(new Date(iso));
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}

export interface FeedDay {
  label: string;
  rows: ReportRow[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Newest first, grouped by Kigali calendar day: "Today", "Yesterday", "Tue 27 Oct".
 * Entries that were undone are left out (they did not happen).
 */
export function groupFeed(rows: ReportRow[], now: Date = new Date()): FeedDay[] {
  const dayNo = (k: Date) => Math.floor(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) / 86_400_000);
  const todayNo = dayNo(kigali(now));

  const sorted = rows
    .filter((r) => !r.reversed)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const days: FeedDay[] = [];
  let current: number | null = null;
  for (const r of sorted) {
    const k = kigali(new Date(r.created_at));
    const no = dayNo(k);
    if (no !== current) {
      const label =
        no === todayNo ? "Today" : no === todayNo - 1 ? "Yesterday" : `${WEEKDAYS[k.getUTCDay()]} ${k.getUTCDate()} ${MONTHS[k.getUTCMonth()]}`;
      days.push({ label, rows: [] });
      current = no;
    }
    days[days.length - 1].rows.push(r);
  }
  return days;
}

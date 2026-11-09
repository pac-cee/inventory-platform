/**
 * Turning the two dates on the Reserve form into the window the API stores.
 *
 * Reserving "from today" starts now (so it holds the units straight away); a
 * later start is the beginning of that day. The last day runs to the end of the
 * day (23:59), so "until Friday" covers all of Friday. Limits mirror the API's
 * so people are told before they submit; the API stays the authority.
 */
export const MAX_START_DAYS = 30;
export const MAX_LENGTH_DAYS = 14;

const parse = (ymd: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 31 Feb rolls over to March: a date that changed is not the date they picked.
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
};

export function windowFromDates(
  fromYmd: string,
  toYmd: string,
  now: Date = new Date(),
): { starts_at?: string; ends_at?: string; error?: string } {
  const from = parse(fromYmd);
  const to = parse(toYmd);
  if (!from || !to) return { error: "Pick both dates." };

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (from.getTime() < todayStart.getTime()) return { error: "The first day cannot be in the past." };
  if (to.getTime() < from.getTime()) return { error: "The last day cannot be before the first day." };

  const starts = from.getTime() === todayStart.getTime() ? now : from;
  const ends = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 0);

  const DAY = 86_400_000;
  if (starts.getTime() > now.getTime() + MAX_START_DAYS * DAY) {
    return { error: `You can reserve at most ${MAX_START_DAYS} days ahead.` };
  }
  if (ends.getTime() - starts.getTime() > MAX_LENGTH_DAYS * DAY) {
    return { error: `A reservation can last at most ${MAX_LENGTH_DAYS} days.` };
  }
  return { starts_at: starts.toISOString(), ends_at: ends.toISOString() };
}

export interface ReservationLike {
  state: "upcoming" | "active" | "expired" | "cancelled" | "fulfilled";
  starts_at: string;
  ends_at: string;
}

const TZ = "Africa/Kigali";
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });

/** "12 Nov – 14 Nov" (or one date when it is a single day). */
export function windowLabel(r: Pick<ReservationLike, "starts_at" | "ends_at">): string {
  const a = day.format(new Date(r.starts_at));
  const b = day.format(new Date(r.ends_at));
  return a === b ? a : `${a} – ${b}`;
}

export function stateLabel(state: ReservationLike["state"]): { text: string; tone: "muted" | "good" | "warn" } {
  switch (state) {
    case "active":
      return { text: "Holding now", tone: "good" };
    case "upcoming":
      return { text: "Upcoming", tone: "muted" };
    case "expired":
      return { text: "Not collected", tone: "warn" };
    case "fulfilled":
      return { text: "Collected", tone: "muted" };
    default:
      return { text: "Cancelled", tone: "muted" };
  }
}

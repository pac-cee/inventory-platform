/**
 * Reservations: hold N units of an item at a location for a window of dates.
 *
 * The rules that need no database are here as pure functions so they can be
 * tested exhaustively; the routes do the locking and the SQL.
 */

/** A reservation may start at most this many days ahead … */
export const MAX_START_DAYS = 30;
/** … and run for at most this many days. */
export const MAX_LENGTH_DAYS = 14;
/** A little slack so "from now" typed a moment ago is not rejected as the past. */
const PAST_GRACE_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** An error message when the window is not acceptable, else null. */
export function checkWindow(start: Date, end: Date, now: Date = new Date()): string | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Those are not valid dates.";
  if (end.getTime() <= start.getTime()) return "The reservation has to end after it starts.";
  if (start.getTime() < now.getTime() - PAST_GRACE_MS) return "The reservation cannot start in the past.";
  if (start.getTime() > now.getTime() + MAX_START_DAYS * DAY_MS) {
    return `A reservation can start at most ${MAX_START_DAYS} days from now.`;
  }
  if (end.getTime() - start.getTime() > MAX_LENGTH_DAYS * DAY_MS) {
    return `A reservation can last at most ${MAX_LENGTH_DAYS} days.`;
  }
  return null;
}

/** Whether two windows share any time. Touching end-to-start does not overlap. */
export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export type ReservationState = "upcoming" | "active" | "expired" | "cancelled" | "fulfilled";

/**
 * Where a reservation stands. "approved" only says it was never cancelled or
 * used; whether it is still ahead, in force, or lapsed unused comes from the
 * dates — which is why nothing needs to run to expire one.
 */
export function reservationState(
  r: { status: string; starts_at: Date | string; ends_at: Date | string },
  now: Date = new Date(),
): ReservationState {
  if (r.status === "cancelled") return "cancelled";
  if (r.status === "fulfilled") return "fulfilled";
  const start = new Date(r.starts_at).getTime();
  const end = new Date(r.ends_at).getTime();
  if (now.getTime() < start) return "upcoming";
  if (now.getTime() < end) return "active";
  return "expired";
}

export interface HeldReservation {
  id: string;
  quantity: number;
}

export type ReservationUse =
  | { id: string; action: "fulfil" }
  | { id: string; action: "reduce"; newQuantity: number };

/**
 * A person takes `quantity` units. Their own active reservations are used up,
 * oldest first: one the take covers completely is fulfilled; one it only
 * partly covers keeps the remainder (so reserving 5 and taking 2 leaves a
 * reservation for 3). Units taken beyond what they reserved are just a take.
 */
export function useReservations(ownActive: HeldReservation[], quantity: number): ReservationUse[] {
  const plan: ReservationUse[] = [];
  let left = quantity;
  for (const r of ownActive) {
    if (left <= 0) break;
    if (r.quantity <= left) {
      plan.push({ id: r.id, action: "fulfil" });
      left -= r.quantity;
    } else {
      plan.push({ id: r.id, action: "reduce", newQuantity: r.quantity - left });
      left = 0;
    }
  }
  return plan;
}

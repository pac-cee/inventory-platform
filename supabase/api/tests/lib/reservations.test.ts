import { describe, it, expect } from "vitest";
import {
  checkWindow,
  MAX_LENGTH_DAYS,
  MAX_START_DAYS,
  reservationState,
  useReservations,
  windowsOverlap,
} from "../../src/lib/reservations.js";

const now = new Date("2026-10-10T08:00:00Z");
const day = (n: number, hour = 8) => new Date(Date.UTC(2026, 9, 10 + n, hour));

describe("checkWindow", () => {
  it("accepts a normal reservation", () => {
    expect(checkWindow(day(2), day(5), now)).toBeNull();
  });
  it("accepts starting right now", () => {
    expect(checkWindow(now, day(1), now)).toBeNull();
    expect(checkWindow(new Date(now.getTime() - 60_000), day(1), now)).toBeNull(); // a minute ago
  });
  it("rejects a start in the past beyond the grace", () => {
    expect(checkWindow(day(-1), day(1), now)).toMatch(/past/);
  });
  it("rejects an end that is not after the start", () => {
    expect(checkWindow(day(2), day(2), now)).toMatch(/end after/);
    expect(checkWindow(day(3), day(2), now)).toMatch(/end after/);
  });
  it(`rejects starting more than ${MAX_START_DAYS} days out`, () => {
    expect(checkWindow(day(MAX_START_DAYS), day(MAX_START_DAYS + 1), now)).toBeNull();
    expect(checkWindow(day(MAX_START_DAYS + 2), day(MAX_START_DAYS + 3), now)).toMatch(/at most 30 days from now/);
  });
  it(`rejects lasting more than ${MAX_LENGTH_DAYS} days`, () => {
    expect(checkWindow(day(1), day(1 + MAX_LENGTH_DAYS), now)).toBeNull();
    expect(checkWindow(day(1), day(2 + MAX_LENGTH_DAYS), now)).toMatch(/at most 14 days/);
  });
  it("rejects nonsense dates", () => {
    expect(checkWindow(new Date("x"), day(1), now)).toMatch(/valid/);
  });
});

describe("windowsOverlap", () => {
  it("detects shared time", () => {
    expect(windowsOverlap(day(1), day(5), day(3), day(8))).toBe(true);
    expect(windowsOverlap(day(1), day(5), day(2), day(3))).toBe(true); // one inside the other
  });
  it("back-to-back windows do not overlap", () => {
    expect(windowsOverlap(day(1), day(3), day(3), day(5))).toBe(false);
  });
  it("separate windows do not overlap", () => {
    expect(windowsOverlap(day(1), day(2), day(4), day(5))).toBe(false);
  });
});

describe("reservationState", () => {
  const r = (status: string, s: number, e: number) => ({ status, starts_at: day(s), ends_at: day(e) });
  it("derives upcoming, active and expired from the dates", () => {
    expect(reservationState(r("approved", 1, 3), now)).toBe("upcoming");
    expect(reservationState(r("approved", -1, 3), now)).toBe("active");
    expect(reservationState(r("approved", -5, -1), now)).toBe("expired");
  });
  it("the stored outcome wins over the dates", () => {
    expect(reservationState(r("cancelled", -1, 3), now)).toBe("cancelled");
    expect(reservationState(r("fulfilled", -1, 3), now)).toBe("fulfilled");
  });
  it("is active from its start instant and expired at its end instant", () => {
    expect(reservationState({ status: "approved", starts_at: now, ends_at: day(2) }, now)).toBe("active");
    expect(reservationState({ status: "approved", starts_at: day(-2), ends_at: now }, now)).toBe("expired");
  });
});

describe("useReservations", () => {
  const held = [
    { id: "a", quantity: 2 },
    { id: "b", quantity: 5 },
  ];
  it("a take that covers a reservation fulfils it", () => {
    expect(useReservations(held, 2)).toEqual([{ id: "a", action: "fulfil" }]);
  });
  it("a take that part-covers one leaves the remainder reserved", () => {
    expect(useReservations([{ id: "b", quantity: 5 }], 2)).toEqual([{ id: "b", action: "reduce", newQuantity: 3 }]);
  });
  it("uses the oldest first and carries on into the next", () => {
    expect(useReservations(held, 4)).toEqual([
      { id: "a", action: "fulfil" },
      { id: "b", action: "reduce", newQuantity: 3 },
    ]);
  });
  it("taking more than reserved fulfils everything; the extra is just a take", () => {
    expect(useReservations(held, 20)).toEqual([
      { id: "a", action: "fulfil" },
      { id: "b", action: "fulfil" },
    ]);
  });
  it("no reservations means nothing to do", () => {
    expect(useReservations([], 3)).toEqual([]);
  });
});

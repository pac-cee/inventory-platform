import { describe, it, expect } from "vitest";
import { stateLabel, windowFromDates, windowLabel } from "./reserve-window";

// Wednesday 21 Oct 2026, 10:00 local.
const now = new Date(2026, 9, 21, 10, 0, 0);
const local = (iso?: string) => new Date(iso!);

describe("windowFromDates", () => {
  it("'from today' starts right now so the units are held straight away", () => {
    const w = windowFromDates("2026-10-21", "2026-10-23", now);
    expect(local(w.starts_at).getTime()).toBe(now.getTime());
  });

  it("a later start is the beginning of that day; the last day runs to 23:59", () => {
    const w = windowFromDates("2026-10-25", "2026-10-27", now);
    const s = local(w.starts_at);
    const e = local(w.ends_at);
    expect([s.getDate(), s.getHours(), s.getMinutes()]).toEqual([25, 0, 0]);
    expect([e.getDate(), e.getHours(), e.getMinutes()]).toEqual([27, 23, 59]);
  });

  it("a single day is fine", () => {
    expect(windowFromDates("2026-10-25", "2026-10-25", now).error).toBeUndefined();
  });

  it("needs both dates, real ones", () => {
    expect(windowFromDates("", "2026-10-25", now).error).toMatch(/both/);
    expect(windowFromDates("2026-10-25", "", now).error).toMatch(/both/);
    expect(windowFromDates("2026-02-31", "2026-03-02", now).error).toMatch(/both/);
  });

  it("refuses the past and a last day before the first", () => {
    expect(windowFromDates("2026-10-20", "2026-10-22", now).error).toMatch(/past/);
    expect(windowFromDates("2026-10-25", "2026-10-24", now).error).toMatch(/before/);
  });

  it("refuses starting too far ahead and lasting too long", () => {
    expect(windowFromDates("2026-12-30", "2026-12-31", now).error).toMatch(/30 days ahead/);
    expect(windowFromDates("2026-10-22", "2026-11-08", now).error).toMatch(/14 days/);
    expect(windowFromDates("2026-10-22", "2026-11-04", now).error).toBeUndefined(); // 14 days is fine
  });
});

describe("labels", () => {
  it("shows a range, or one date when it is a single day", () => {
    expect(windowLabel({ starts_at: "2026-11-12T08:00:00Z", ends_at: "2026-11-14T21:59:00Z" })).toBe("12 Nov – 14 Nov");
    expect(windowLabel({ starts_at: "2026-11-12T08:00:00Z", ends_at: "2026-11-12T20:00:00Z" })).toBe("12 Nov");
  });
  it("names each state in plain words", () => {
    expect(stateLabel("active")).toEqual({ text: "Holding now", tone: "good" });
    expect(stateLabel("upcoming").text).toBe("Upcoming");
    expect(stateLabel("expired")).toEqual({ text: "Not collected", tone: "warn" });
    expect(stateLabel("fulfilled").text).toBe("Collected");
    expect(stateLabel("cancelled").text).toBe("Cancelled");
  });
});

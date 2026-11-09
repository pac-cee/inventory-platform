import { describe, it, expect } from "vitest";
import { dueLabel, returnByIso } from "./return-by";

// Local-time "now": Wednesday 21 Oct 2026, 10:00.
const now = new Date(2026, 9, 21, 10, 0, 0);
const local = (iso: string | null) => (iso ? new Date(iso) : null);

describe("returnByIso", () => {
  it("'no fixed date' sends nothing", () => {
    expect(returnByIso("none", "", now)).toEqual({ iso: null });
  });

  it("'today' is the end of today", () => {
    const d = local(returnByIso("today", "", now).iso)!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 21, 23, 59]);
  });

  it("'tomorrow', 'week' and 'month' are the end of that day", () => {
    const at = (c: "tomorrow" | "week" | "month") => {
      const d = local(returnByIso(c, "", now).iso)!;
      return [d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
    };
    expect(at("tomorrow")).toEqual([9, 22, 23, 59]);
    expect(at("week")).toEqual([9, 28, 23, 59]);
    expect(at("month")).toEqual([10, 21, 23, 59]);
  });

  it("'today' late on the last minute has already passed", () => {
    const lateNow = new Date(2026, 9, 21, 23, 59, 30);
    expect(returnByIso("today", "", lateNow).error).toMatch(/passed/);
  });

  it("a picked date is the end of that day", () => {
    const d = local(returnByIso("custom", "2026-11-05", now).iso)!;
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([10, 5, 23, 59]);
  });

  it("asks for a date when none was picked, and rejects past or impossible ones", () => {
    expect(returnByIso("custom", "", now).error).toMatch(/Pick/);
    expect(returnByIso("custom", "2026-10-01", now).error).toMatch(/passed/);
    expect(returnByIso("custom", "2026-02-31", now).error).toMatch(/real date/);
  });
});

describe("dueLabel", () => {
  it("open-ended loans are quiet", () => {
    expect(dueLabel({ status: "none", expected_return_at: null, days_overdue: 0 })).toEqual({ text: "No fixed return date", tone: "muted" });
  });
  it("due today is a warning", () => {
    expect(dueLabel({ status: "due_today", expected_return_at: "2026-10-21T21:59:00Z", days_overdue: 0 })).toEqual({ text: "Due today", tone: "warn" });
  });
  it("overdue is loud and counts days", () => {
    expect(dueLabel({ status: "overdue", expected_return_at: "2026-10-18T21:59:00Z", days_overdue: 3 })).toEqual({ text: "Overdue · 3 days", tone: "bad" });
    expect(dueLabel({ status: "overdue", expected_return_at: "x", days_overdue: 1 }).text).toBe("Overdue · 1 day");
    expect(dueLabel({ status: "overdue", expected_return_at: "x", days_overdue: 0 }).text).toBe("Overdue");
  });
  it("upcoming shows the date in Kigali time", () => {
    // 22:00 UTC on the 30th is already the 31st in Kigali (UTC+2).
    // (Runtimes differ on a comma after the weekday, so match either.)
    expect(dueLabel({ status: "upcoming", expected_return_at: "2026-10-30T22:00:00Z", days_overdue: 0 }).text).toMatch(/^Due Sat,? 31 Oct$/);
  });
});

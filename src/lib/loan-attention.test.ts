import { describe, it, expect } from "vitest";
import type { Loan } from "@/lib/api/types";
import { loansNeedingAttention } from "./loan-attention";

// 20 Oct 2026, 09:00 Kigali.
const now = new Date(Date.UTC(2026, 9, 20, 7, 0, 0));
const kigali = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour - 2, 0, 0)).toISOString();

const loan = (name: string, status: Loan["status"], due: string | null, days = 0): Loan => ({
  take_id: name,
  item_id: name,
  item_name: name,
  user_id: "u",
  user_name: "Tony",
  location_id: "l",
  location_name: "Box",
  quantity: 1,
  taken_at: "2026-10-01T08:00:00Z",
  expected_return_at: due,
  status,
  days_overdue: days,
});

describe("loansNeedingAttention", () => {
  it("keeps late, due today and due tomorrow; drops later and open-ended", () => {
    const all = [
      loan("late", "overdue", kigali(18, 17), 2),
      loan("today", "due_today", kigali(20, 17)),
      loan("tomorrow", "upcoming", kigali(21, 17)),
      loan("nextweek", "upcoming", kigali(27, 17)),
      loan("open", "none", null),
    ];
    expect(loansNeedingAttention(all, now).map((l) => l.item_name)).toEqual(["late", "today", "tomorrow"]);
  });

  it("puts the most overdue first, then today, then tomorrow", () => {
    const all = [
      loan("tomorrow", "upcoming", kigali(21, 17)),
      loan("today", "due_today", kigali(20, 17)),
      loan("late2", "overdue", kigali(18, 17), 2),
      loan("late5", "overdue", kigali(15, 17), 5),
    ];
    expect(loansNeedingAttention(all, now).map((l) => l.item_name)).toEqual(["late5", "late2", "today", "tomorrow"]);
  });

  it("uses the Kigali day: 23:30 on the 21st is still tomorrow at 09:00 on the 20th", () => {
    expect(loansNeedingAttention([loan("x", "upcoming", kigali(21, 23))], now)).toHaveLength(1);
  });

  it("nothing to nudge about is an empty list", () => {
    expect(loansNeedingAttention([], now)).toEqual([]);
  });
});

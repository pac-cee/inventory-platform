import { describe, it, expect } from "vitest";
import {
  checkDueDate,
  daysOverdue,
  dueStatus,
  outstandingLoans,
  type LedgerRow,
} from "../../src/lib/loans.js";

let n = 0;
const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 9, day, hour - 2, 0, 0)); // Kigali is UTC+2
function row(p: Partial<LedgerRow> & { contrib: number; reason?: string }): LedgerRow {
  n += 1;
  return {
    id: `m${String(n).padStart(3, "0")}`,
    item_id: "pi",
    user_id: "tony",
    location_id: "box1",
    reason: p.reason ?? (p.contrib > 0 ? "take" : "return"),
    created_at: at(1),
    expected_return_at: null,
    ...p,
  };
}

describe("outstandingLoans — FIFO", () => {
  it("one take, nothing returned: one loan with its due date", () => {
    const due = at(10);
    const loans = outstandingLoans([row({ contrib: 3, created_at: at(1), expected_return_at: due })]);
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ quantity: 3, expected_return_at: due });
  });

  it("returning everything clears the loan", () => {
    const loans = outstandingLoans([
      row({ contrib: 3, created_at: at(1) }),
      row({ contrib: -3, created_at: at(2) }),
    ]);
    expect(loans).toEqual([]);
  });

  it("a partial return clears the OLDEST take first", () => {
    const friday = at(5);
    const nextWeek = at(12);
    const loans = outstandingLoans([
      row({ contrib: 2, created_at: at(1), expected_return_at: friday }), // Monday: 2, due Friday
      row({ contrib: 3, created_at: at(3), expected_return_at: nextWeek }), // Wednesday: 3, due next week
      row({ contrib: -2, created_at: at(4) }), // returns 2
    ]);
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ quantity: 3, expected_return_at: nextWeek });
  });

  it("a return can split a take: the rest keeps that take's date", () => {
    const due = at(9);
    const loans = outstandingLoans([
      row({ contrib: 5, created_at: at(1), expected_return_at: due }),
      row({ contrib: -2, created_at: at(2) }),
    ]);
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ quantity: 3, expected_return_at: due });
  });

  it("a return spanning two takes consumes the first fully and part of the second", () => {
    const loans = outstandingLoans([
      row({ contrib: 2, created_at: at(1), expected_return_at: at(5) }),
      row({ contrib: 4, created_at: at(2), expected_return_at: at(8) }),
      row({ contrib: -3, created_at: at(3) }),
    ]);
    expect(loans.map((l) => l.quantity)).toEqual([3]);
    expect(loans[0].expected_return_at).toEqual(at(8));
  });

  it("damage or loss releases units like a return does", () => {
    const loans = outstandingLoans([
      row({ contrib: 4, created_at: at(1), expected_return_at: at(9) }),
      row({ contrib: -1, reason: "destroyed", created_at: at(2) }),
      row({ contrib: -1, reason: "lost", created_at: at(3) }),
    ]);
    expect(loans[0].quantity).toBe(2);
  });

  it("a take with no date stays an open-ended loan", () => {
    const loans = outstandingLoans([row({ contrib: 2, created_at: at(1) })]);
    expect(loans[0].expected_return_at).toBeNull();
  });

  it("keeps different people and different items apart", () => {
    const loans = outstandingLoans([
      row({ contrib: 2, user_id: "tony", created_at: at(1) }),
      row({ contrib: 3, user_id: "amina", created_at: at(1) }),
      row({ contrib: 1, item_id: "cable", user_id: "tony", created_at: at(1) }),
      row({ contrib: -2, user_id: "tony", created_at: at(2) }), // clears only Tony's Pi
    ]);
    const by = Object.fromEntries(loans.map((l) => [`${l.user_id}/${l.item_id}`, l.quantity]));
    expect(by).toEqual({ "amina/pi": 3, "tony/cable": 1 });
  });

  it("is independent of the order the rows arrive in", () => {
    const rows = [
      row({ contrib: 2, created_at: at(1), expected_return_at: at(5) }),
      row({ contrib: 3, created_at: at(3), expected_return_at: at(12) }),
      row({ contrib: -2, created_at: at(4) }),
    ];
    expect(outstandingLoans([...rows].reverse())).toEqual(outstandingLoans(rows));
  });

  it("total outstanding always equals the plain sum of contributions (what 'held' reports)", () => {
    const rows = [
      row({ contrib: 5, created_at: at(1), expected_return_at: at(7) }),
      row({ contrib: -2, created_at: at(2) }),
      row({ contrib: 4, created_at: at(3) }),
      row({ contrib: -1, reason: "destroyed", created_at: at(4) }),
      row({ contrib: -3, created_at: at(5) }),
    ];
    const total = outstandingLoans(rows).reduce((s, l) => s + l.quantity, 0);
    expect(total).toBe(rows.reduce((s, r) => s + r.contrib, 0));
  });

  it("ignores rows that change nothing", () => {
    expect(outstandingLoans([row({ contrib: 0, reason: "adjust" })])).toEqual([]);
  });
});

describe("dueStatus / daysOverdue (Kigali days)", () => {
  const now = at(10, 9); // 10 Oct, 09:00 Kigali

  it("no date means no status", () => {
    expect(dueStatus(null, now)).toBe("none");
    expect(daysOverdue(null, now)).toBe(0);
  });
  it("later today is due today, not overdue", () => {
    expect(dueStatus(at(10, 17), now)).toBe("due_today");
    expect(daysOverdue(at(10, 17), now)).toBe(0);
  });
  it("a later day is upcoming", () => {
    expect(dueStatus(at(11, 9), now)).toBe("upcoming");
  });
  it("earlier today is overdue by zero whole days", () => {
    expect(dueStatus(at(10, 8), now)).toBe("overdue");
    expect(daysOverdue(at(10, 8), now)).toBe(0);
  });
  it("counts whole calendar days late", () => {
    expect(dueStatus(at(7, 17), now)).toBe("overdue");
    expect(daysOverdue(at(7, 17), now)).toBe(3);
  });
  it("uses the Kigali day, not UTC: 23:30 Kigali on the 9th is already 21:30 UTC on the 9th, still a full day before the 10th", () => {
    expect(daysOverdue(at(9, 23), now)).toBe(1);
  });
});

describe("checkDueDate", () => {
  const now = new Date("2026-10-10T07:00:00Z");
  it("accepts a sensible future date", () => {
    expect(checkDueDate(new Date("2026-10-17T15:00:00Z"), now)).toBeNull();
  });
  it("rejects the past, now, and nonsense", () => {
    expect(checkDueDate(new Date("2026-10-09T00:00:00Z"), now)).toMatch(/future/);
    expect(checkDueDate(now, now)).toMatch(/future/);
    expect(checkDueDate(new Date("nope"), now)).toMatch(/valid/);
  });
  it("rejects more than a year out", () => {
    expect(checkDueDate(new Date("2028-01-01T00:00:00Z"), now)).toMatch(/year/);
  });
});

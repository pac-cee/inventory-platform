import { describe, it, expect } from "vitest";
import { isReminderTime, OVERDUE_EVERY, reminderFor } from "../../src/lib/reminders.js";

// Kigali is UTC+2, so 09:00 Kigali is 07:00 UTC.
const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 9, day, hour - 2, 0, 0));
const now = at(20, 9); // 20 Oct, 09:00 Kigali

describe("reminderFor", () => {
  it("open-ended loans never trigger a reminder", () => {
    expect(reminderFor(null, now)).toBeNull();
  });

  it("the day before: due tomorrow", () => {
    expect(reminderFor(at(21, 17), now)).toBe("due_tomorrow");
  });

  it("the due day itself: due today (even at 17:00, with the day still ahead)", () => {
    expect(reminderFor(at(20, 17), now)).toBe("due_today");
  });

  it("two or more days ahead: nothing yet", () => {
    expect(reminderFor(at(22, 17), now)).toBeNull();
    expect(reminderFor(at(30, 17), now)).toBeNull();
  });

  it("goes quiet while less than a whole day late (due earlier today)", () => {
    expect(reminderFor(at(20, 8), now)).toBeNull();
  });

  it("then reminds 1 day late, and every 3 days after: 1, 4, 7, 10", () => {
    const kinds = (lateBy: number) => reminderFor(at(20 - lateBy, 17), now);
    expect(kinds(1)).toBe("overdue_1");
    expect(kinds(2)).toBeNull();
    expect(kinds(3)).toBeNull();
    expect(kinds(4)).toBe("overdue_4");
    expect(kinds(7)).toBe("overdue_7");
    expect(kinds(10)).toBe("overdue_10");
    expect(kinds(5)).toBeNull();
    expect(OVERDUE_EVERY).toBe(3);
  });

  it("uses the Kigali calendar day, not UTC: 23:30 Kigali on the 21st is still 'tomorrow' at 09:00 on the 20th", () => {
    expect(reminderFor(at(21, 23), now)).toBe("due_tomorrow");
  });

  it("each step has its own kind, so a step is sent once and the next step is a new message", () => {
    expect(reminderFor(at(19, 17), now)).not.toBe(reminderFor(at(16, 17), now));
  });
});

describe("isReminderTime", () => {
  it("is false in the small hours and true from 08:00 Kigali", () => {
    expect(isReminderTime(at(20, 3))).toBe(false);
    expect(isReminderTime(at(20, 7))).toBe(false);
    expect(isReminderTime(at(20, 8))).toBe(true);
    expect(isReminderTime(at(20, 15))).toBe(true);
    expect(isReminderTime(at(20, 23))).toBe(true);
  });
});

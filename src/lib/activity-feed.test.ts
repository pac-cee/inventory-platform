import { describe, it, expect } from "vitest";
import type { ReportRow } from "@/lib/api/types";
import { feedItemLabel, feedSentence, feedTime, groupFeed } from "./activity-feed";

const row = (o: Partial<ReportRow> & { id: string; created_at: string; reason: ReportRow["reason"] }): ReportRow => ({
  label: "",
  units: 2,
  delta: -2,
  capacity_delta: 0,
  damaged_delta: 0,
  item: { id: "i1", type: "Cable", name: "USB-A to C", model: "1m", sku: "vrlt-cbl-001", specification: null },
  location: { id: "l1", name: "Hardware › Box 4" },
  person: { id: "p1", name: "Amina" },
  actor: { id: "p1", name: "Amina" },
  note: null,
  reversed: false,
  ...o,
});

const NOW = new Date("2026-10-30T10:00:00Z"); // 12:00 in Kigali

describe("feedSentence", () => {
  it("says who took or returned how many of what", () => {
    expect(feedSentence(row({ id: "1", created_at: "2026-10-30T08:00:00Z", reason: "take" }))).toBe("Amina took 2 × Cable · USB-A to C · 1m");
    expect(feedSentence(row({ id: "2", created_at: "2026-10-30T08:00:00Z", reason: "return", units: 1 }))).toBe("Amina returned 1 × Cable · USB-A to C · 1m");
  });
  it("leaves out a name that repeats the type and the placeholder model", () => {
    const r = row({ id: "1", created_at: "2026-10-30T08:00:00Z", reason: "take", item: { id: "i", type: "Laptop", name: "Laptop", model: "Unspecified", sku: "x", specification: null } });
    expect(feedItemLabel(r)).toBe("Laptop");
  });
  it("mentions who recorded it only when it was someone else", () => {
    const other = row({ id: "1", created_at: "2026-10-30T08:00:00Z", reason: "take", actor: { id: "p2", name: "Brian" } });
    expect(feedSentence(other)).toContain("(recorded by Brian)");
    expect(feedSentence(row({ id: "2", created_at: "2026-10-30T08:00:00Z", reason: "take" }))).not.toContain("recorded by");
  });
  it("never prints a blank or null name", () => {
    const s = feedSentence(row({ id: "1", created_at: "2026-10-30T08:00:00Z", reason: "take", person: { id: null, name: null }, actor: { id: null, name: "" } }));
    expect(s.startsWith("Someone took")).toBe(true);
    expect(s).not.toContain("null");
  });
  it("reports damage as damage", () => {
    expect(feedSentence(row({ id: "1", created_at: "2026-10-30T08:00:00Z", reason: "destroyed" }))).toBe("2 × Cable · USB-A to C · 1m damaged (Amina)");
  });
});

describe("groupFeed", () => {
  it("groups by Kigali day, newest first, labelled Today / Yesterday / date", () => {
    const g = groupFeed(
      [
        row({ id: "old", created_at: "2026-10-27T09:00:00Z", reason: "take" }),
        row({ id: "t1", created_at: "2026-10-30T07:00:00Z", reason: "take" }),
        row({ id: "y1", created_at: "2026-10-29T12:00:00Z", reason: "return" }),
        row({ id: "t2", created_at: "2026-10-30T09:00:00Z", reason: "return" }),
      ],
      NOW,
    );
    expect(g.map((d) => d.label)).toEqual(["Today", "Yesterday", "Tue 27 Oct"]);
    expect(g[0].rows.map((r) => r.id)).toEqual(["t2", "t1"]);
  });
  it("uses Kigali midnight, not UTC: 23:30 UTC is already the next day there", () => {
    expect(groupFeed([row({ id: "late", created_at: "2026-10-29T23:30:00Z", reason: "take" })], NOW)[0].label).toBe("Today");
  });
  it("leaves out undone entries, and an empty list is an empty feed", () => {
    expect(groupFeed([row({ id: "u", created_at: "2026-10-30T08:00:00Z", reason: "take", reversed: true })], NOW)).toEqual([]);
    expect(groupFeed([], NOW)).toEqual([]);
  });
});

it("feedTime is Kigali time", () => {
  expect(feedTime("2026-10-30T08:05:00Z")).toBe("10:05");
});

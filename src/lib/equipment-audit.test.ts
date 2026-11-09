import { describe, it, expect } from "vitest";
import type { Loan } from "@/lib/api/types";
import { filterLoans, groupByPerson, loansToCsv, summarize } from "./equipment-audit";

const loan = (o: Partial<Loan>): Loan => ({
  take_id: "t",
  item_id: "i",
  item_name: "Cable · USB-A to C",
  user_id: "u1",
  user_name: "Amina",
  location_id: "l",
  location_name: "Box 4",
  quantity: 1,
  taken_at: "2026-10-01T08:00:00.000Z",
  expected_return_at: "2026-10-10T00:00:00.000Z",
  status: "upcoming",
  days_overdue: 0,
  ...o,
});

const sample = [
  loan({ take_id: "1", user_id: "u1", user_name: "Amina", status: "overdue", days_overdue: 3, quantity: 2 }),
  loan({ take_id: "2", user_id: "u2", user_name: "Brian", item_name: "Raspberry Pi", status: "upcoming" }),
  loan({ take_id: "3", user_id: "u1", user_name: "Amina", item_name: "Soldering iron", status: "overdue", days_overdue: 9 }),
  loan({ take_id: "4", user_id: "u3", user_name: "Chloé", status: "none", expected_return_at: null }),
];

describe("filterLoans", () => {
  it("keeps everything for 'all' and an empty query", () => {
    expect(filterLoans(sample, "all", "  ")).toHaveLength(4);
  });
  it("narrows by status", () => {
    expect(filterLoans(sample, "overdue", "").map((l) => l.take_id)).toEqual(["1", "3"]);
    expect(filterLoans(sample, "none", "").map((l) => l.take_id)).toEqual(["4"]);
  });
  it("matches person, item or place, ignoring case", () => {
    expect(filterLoans(sample, "all", "BRIAN").map((l) => l.take_id)).toEqual(["2"]);
    expect(filterLoans(sample, "all", "solder").map((l) => l.take_id)).toEqual(["3"]);
    expect(filterLoans(sample, "all", "box 4")).toHaveLength(4);
  });
  it("combines status and text", () => {
    expect(filterLoans(sample, "overdue", "pi")).toHaveLength(0);
    expect(filterLoans(sample, "overdue", "amina")).toHaveLength(2);
  });
});

describe("summarize", () => {
  it("counts loans, units, distinct people and overdue", () => {
    expect(summarize(sample)).toEqual({ loans: 4, units: 5, people: 3, overdue: 2 });
    expect(summarize([])).toEqual({ loans: 0, units: 0, people: 0, overdue: 0 });
  });
});

describe("groupByPerson", () => {
  it("totals each person and puts the most overdue first", () => {
    const g = groupByPerson(sample);
    expect(g.map((p) => p.user_name)).toEqual(["Amina", "Brian", "Chloé"]);
    expect(g[0]).toMatchObject({ units: 3, overdue: 2, worstDaysOverdue: 9 });
    expect(g[0].loans).toHaveLength(2);
  });
  it("breaks ties alphabetically and names a nameless person", () => {
    const g = groupByPerson([loan({ user_id: "x", user_name: "" }), loan({ user_id: "a", user_name: "Ada" })]);
    expect(g.map((p) => p.user_name)).toEqual(["Ada", "Unknown"]);
  });
});

describe("loansToCsv", () => {
  it("writes a header, quotes awkward values and leaves a missing due date empty", () => {
    const csv = loansToCsv([loan({ item_name: 'Cable, "long"', expected_return_at: null, status: "none" })]);
    const [head, row] = csv.split("\n");
    expect(head).toBe("Person,Item,Quantity,Location,Taken,Due,Status,Days overdue");
    expect(row).toBe('Amina,"Cable, ""long""",1,Box 4,2026-10-01,,none,0');
  });
});

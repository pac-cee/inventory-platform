import { describe, it, expect } from "vitest";
import { bodyForGroup, pdfFilename, type PdfGroup } from "./condition-pdf";
import { LETTERHEAD } from "./letterhead";
import { groupVariants } from "./condition-group";
import type { ConditionRow } from "@/lib/api/types";

const row = (over: Partial<ConditionRow> = {}): ConditionRow =>
  ({
    item_id: "i",
    location_id: "l",
    type: "Dell Latitude 5420",
    name: "Base",
    model: "Unspecified",
    sku: "vrlt-dll-001",
    specification: null,
    category: "Computers",
    package_label: null,
    units_per_container: 1,
    location_name: "Shelf",
    room_id: "r",
    room_name: "Room",
    total: 10,
    available: 10,
    damaged: 0,
    operational: 10,
    in_use: 0,
    faults: [],
    accounted: 0,
    ...over,
  }) as ConditionRow;

/** Rows go through the same grouping the report applies before printing. */
const group = (cats: { name: string; items: ConditionRow[] }[]): PdfGroup => ({
  name: "Room",
  categories: cats.map((c) => ({ name: c.name, items: groupVariants(c.items, "location") })),
});

/** The printed cells, with the heading marker dropped. */
const cells = (b: ReturnType<typeof bodyForGroup>) => b.map((r) => r.cells);

describe("bodyForGroup", () => {
  it("emits one row per item, in report column order", () => {
    const body = bodyForGroup(
      group([{ name: "Computers", items: [row({ specification: "16GB RAM", total: 10 })] }]),
    );
    expect(cells(body)).toEqual([
      // Category, Item type, Name, Model, SKU, Specification, Location,
      // Quantity, Condition, % Operational, Recommendation.
      [
        "Computers",
        "Dell Latitude 5420",
        "Base",
        "Unspecified",
        "vrlt-dll-001",
        "16GB RAM",
        "Shelf",
        "10",
        "Good",
        "100 %",
        "—",
      ],
    ]);
    expect(body[0].heading).toBe(false);
  });

  it("writes the category once per block, as on paper", () => {
    // Two different products, so they stay two lines.
    const body = bodyForGroup(
      group([
        {
          name: "Computers",
          items: [row({ type: "Latitude 5420" }), row({ type: "ProDesk 400" })],
        },
      ]),
    );
    expect(body).toHaveLength(2);
    expect(body[0].cells[0]).toBe("Computers");
    expect(body[1].cells[0]).toBe("");
  });

  it("merges spec-only variants into a single line", () => {
    // Same (absent) SKU, so these are one item in two specs.
    const body = bodyForGroup(
      group([
        {
          name: "Computers",
          items: [
            row({ item_id: "a", specification: "8GB RAM", total: 9, operational: 9 }),
            row({ item_id: "b", specification: "16GB RAM", total: 6, operational: 6 }),
          ],
        },
      ]),
    );
    expect(body).toHaveLength(1);
    expect(body[0].cells[1]).toBe("Dell Latitude 5420");
    expect(body[0].cells[5]).toBe("8GB RAM (9), 16GB RAM (6)");
    expect(body[0].cells[7]).toBe("15");
  });

  it("writes a shared name once, with its SKUs nested beneath", () => {
    const body = bodyForGroup(
      group([
        {
          name: "Computers",
          items: [
            row({ item_id: "a", name: "CPU-08", total: 9, operational: 9 }),
            row({ item_id: "b", name: "CPU-16", total: 6, operational: 6 }),
          ],
        },
      ]),
    );
    // A heading carrying the name and combined total, then a line per SKU.
    expect(body).toHaveLength(3);
    expect(body[0].heading).toBe(true);
    expect(body[0].cells[0]).toBe("Computers");
    expect(body[0].cells[1]).toBe("Dell Latitude 5420");
    expect(body[0].cells[2]).toBe("CPU-08 · CPU-16");
    expect(body[0].cells[7]).toBe("15");
    expect(body[0].cells[9]).toBe("100 %");

    // The name is not repeated; each SKU keeps its own numbers.
    expect(body.slice(1).map((r) => r.heading)).toEqual([false, false]);
    expect(body[1].cells[1]).toBe("");
    expect(body[1].cells[2]).toBe("CPU-08");
    // The model now has a column of its own rather than riding on the name.
    expect(body[1].cells[3]).toBe("Unspecified");
    expect(body[1].cells[7]).toBe("9");
    expect(body[2].cells[1]).toBe("");
    expect(body[2].cells[2]).toBe("CPU-16");
    expect(body[2].cells[7]).toBe("6");
  });

  it("does not nest a name that has only one line", () => {
    const body = bodyForGroup(
      group([{ name: "Computers", items: [row({ name: "CPU-08" })] }]),
    );
    expect(body).toHaveLength(1);
    expect(body[0].heading).toBe(false);
    expect(body[0].cells[1]).toBe("Dell Latitude 5420");
  });

  it("writes the category once even when the first name is nested", () => {
    const body = bodyForGroup(
      group([
        {
          name: "Computers",
          items: [
            row({ item_id: "a", name: "CPU-08" }),
            row({ item_id: "b", name: "CPU-16" }),
            row({ item_id: "c", type: "ProDesk 400", name: "PD-400" }),
          ],
        },
      ]),
    );
    // Heading, its two SKUs, then the unrelated product.
    expect(body.map((r) => r.cells[0])).toEqual(["Computers", "", "", ""]);
  });

  it("carries the fault tally and the recommendation", () => {
    const body = bodyForGroup(
      group([
        {
          name: "Computers",
          items: [
            row({
              total: 28,
              damaged: 19,
              operational: 9,
              accounted: 19,
              faults: [{ note: "batteries died", units: 19, recommendation: "Replace batteries" }],
            }),
          ],
        },
      ]),
    );
    expect(body[0].cells[8]).toBe("9 good, 19 batteries died");
    expect(body[0].cells[9]).toBe("32.1 %");
    expect(body[0].cells[10]).toBe("Replace batteries");
  });

  it("returns nothing for an empty group", () => {
    expect(bodyForGroup(group([]))).toEqual([]);
  });
});

describe("pdfFilename", () => {
  it("is dated", () => {
    expect(pdfFilename(new Date("2026-08-06T10:00:00Z"))).toBe("condition-report-2026-08-06.pdf");
  });
});

describe("letterhead", () => {
  it("carries the addresses the report is meant to give out", () => {
    expect(LETTERHEAD.email).toBe("Email: rw@verlet.co");
    expect(LETTERHEAD.website).toBe("Website: https://inventory.verlet.co");
  });

  it("leaves the Prepared By signature row to be filled by the operator", () => {
    // A hardcoded name here reappears as a signature line that contradicts the
    // "Prepared by: <person>" printed at the top of the same page.
    const prepared = LETTERHEAD.approvals.find((a) => a.role === "Prepared By");
    expect(prepared).toBeDefined();
    expect(prepared!.who).toBeNull();
  });

  it("keeps the other signatories as roles, since they sign by hand", () => {
    const others = LETTERHEAD.approvals.filter((a) => a.role !== "Prepared By");
    expect(others.length).toBeGreaterThan(0);
    for (const a of others) expect(a.who).toBeTruthy();
  });
});

import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs helper next to the script, no type declarations
import { planKindFixes } from "../../location-kinds-lib.mjs";

// The real production shape: Hardware Area > Shelves (a grouping) > Shelf 2 > level 0 ...
let n = 0;
const row = (name: string, kind: string, parent?: { id: string }) => ({ id: `id${++n}`, name, kind, parent_id: parent?.id ?? null });

function hardware() {
  const hw = row("Hardware Area", "area");
  const shelves = row("Shelves", "shelf", hw);
  const tables = row("Tables", "shelf", hw);
  const s2 = row("Shelf 2", "level", shelves);
  const s1 = row("shelf 1", "level", shelves);
  const rows = [hw, shelves, tables, s2, s1];
  const levels: ReturnType<typeof row>[] = [];
  for (const s of [s2, s1]) for (let i = 0; i < 3; i++) levels.push(row(`level ${i}`, "area", s));
  const stray = row("#1", "shelf", levels[5]); // a stray place under a level
  const topBox = row("Screw Drivers", "box");
  const main = row("Main Hall", "area");
  const mainTables = row("Tables", "shelf", main);
  const test = row("Test", "area");
  const t0 = row("Shelf 0", "shelf", test);
  const t0l0 = row("Level 0", "level", t0);
  return { rows: [...rows, ...levels, stray, topBox, main, mainTables, test, t0, t0l0], ids: { hw, shelves, tables, s2, s1, levels, stray, topBox } };
}

describe("planKindFixes: typing the places made before types existed", () => {
  it("with the grouping named, the shelves become shelves and their levels become levels", () => {
    const { rows, ids } = hardware();
    const { plan } = planKindFixes(rows, { groupings: ["Shelves"] });
    const to = Object.fromEntries(plan.map((p: any) => [p.id, p.to]));
    expect(to[ids.shelves.id]).toBe("area"); // the grouping is kept as an area
    expect(to[ids.s2.id]).toBe("shelf"); // was wrongly stored as a level
    expect(to[ids.s1.id]).toBe("shelf");
    for (const l of ids.levels) expect(to[l.id]).toBe("level");
  });

  it("leaves correct places alone (Tables, Test > Shelf 0 > Level 0, the top-level areas)", () => {
    const { rows, ids } = hardware();
    const { plan } = planKindFixes(rows, { groupings: ["Shelves"] });
    const touched = new Set(plan.map((p: any) => p.name));
    expect(touched.has("Tables")).toBe(false);
    expect(touched.has("Shelf 0")).toBe(false);
    expect(touched.has("Level 0")).toBe(false); // the correct one under Test
    expect(plan.some((p: any) => p.id === ids.hw.id)).toBe(false);
  });

  it("never makes a box: a stray place under a level and boxes sitting at the top are listed for a person", () => {
    const { rows } = hardware();
    const { plan, manual } = planKindFixes(rows, { groupings: ["Shelves"] });
    expect(plan.some((p: any) => p.to === "box")).toBe(false);
    const paths = manual.map((m: any) => m.path);
    expect(paths.some((p: string) => p.endsWith("> #1"))).toBe(true);
    expect(paths).toContain("Screw Drivers");
  });

  it("a place already stored as a box is never changed", () => {
    const { rows } = hardware();
    const { plan } = planKindFixes(rows, { groupings: ["Shelves"] });
    expect(plan.some((p: any) => p.name === "Screw Drivers")).toBe(false);
  });

  it("without naming the grouping, the layers come out one step off — which is why the tree is reviewed first", () => {
    const { rows, ids } = hardware();
    const { plan } = planKindFixes(rows, {});
    const to = Object.fromEntries(plan.map((p: any) => [p.id, p.to]));
    expect(to[ids.s2.id]).toBeUndefined(); // "Shelf 2" is depth 2 = level: no change proposed
    expect(to[ids.levels[0].id]).toBeUndefined(); // its levels are depth 3: left for a person
  });

  it("a grouping is only honoured directly inside a top-level area", () => {
    const hw = row("Hardware Area", "area");
    const shelf = row("Shelf A", "shelf", hw);
    const deep = row("Shelves", "area", shelf); // not directly inside an area
    const { plan } = planKindFixes([hw, shelf, deep], { groupings: ["Shelves"] });
    expect(plan.find((p: any) => p.name === "Shelves")?.to).toBe("level"); // treated as an ordinary step
  });

  it("is safe against a loop in the data", () => {
    const a: any = { id: "x1", name: "A", kind: "area", parent_id: "x2" };
    const b: any = { id: "x2", name: "B", kind: "area", parent_id: "x1" };
    expect(() => planKindFixes([a, b])).not.toThrow();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  AREA,
  COLUMNS,
  COLUMN_SIZE,
  DESKS,
  DOOR,
  OFFICES,
  PIECES,
  TABLE_HOMES,
  applyPlan,
  defaultPlan,
  locationHome,
  mirrorPlan,
  pieceRect,
  resizePlan,
  sanitizePlan,
  turnPlan,
  type Rect,
} from "./verlet-site";

const LOCATIONS = [
  "Cables box", "Camera box", "Field Kit", "Front desk", "Lab A", "Main Store",
  "Main Warehouse", "Office", "Rack 1", "Rack 1 · Level 2", "Robotics Lab",
  "Shelf A", "Shelf B",
];
const overlap = (a: Rect, b: Rect) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
/** A live shelf is drawn 2 m wide and 0.5 m deep; a table 2 m by 1 m. */
function boxRect(x: number, z: number, rotation: number, depth: number): Rect {
  const side = Math.abs(Math.sin((rotation * Math.PI) / 180)) > 0.5;
  const hx = side ? depth / 2 : 1, hz = side ? 1 : depth / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}
/** Everything standing in the hall of the live plan, by name. */
function standing(): [string, Rect][] {
  return [
    ...LOCATIONS.map((n) => {
      const h = locationHome(n, 0);
      return [n, boxRect(h.x, h.z, h.rotation, 0.5)] as [string, Rect];
    }),
    ...Object.entries(TABLE_HOMES).map(([id, h]) => [id, boxRect(h.x, h.z, h.rotation, 1)] as [string, Rect]),
    ...PIECES.filter((p) => p.z > AREA.z0).map((p) => [p.id, pieceRect(p, 0)] as [string, Rect]),
    ...COLUMNS.map(([x, z]) => {
      const c = COLUMN_SIZE / 2;
      return [`column ${x},${z}`, { minX: x - c, maxX: x + c, minZ: z - c, maxZ: z + c }] as [string, Rect];
    }),
  ];
}
afterEach(() => {
  applyPlan(null);
});

describe("the default floor", () => {
  it("is a 24 m hall with three pillars along its length", () => {
    expect(AREA).toEqual({ x0: -12, x1: 12, z0: -12, z1: 12 });
    expect(new Set(COLUMNS.map(([x]) => x)).size).toBe(3);
    expect(COLUMNS).toHaveLength(9);
    expect(OFFICES.rooms).toEqual([-12, -4, 4, 12]);
  });
  it("keeps every shelf, table and piece inside the hall's walls", () => {
    for (const [name, r] of standing())
      expect(
        r.minX >= AREA.x0 && r.maxX <= AREA.x1 && r.minZ >= AREA.z0 && r.maxZ <= AREA.z1,
        name,
      ).toBe(true);
  });
  it("never stands two things in the same place", () => {
    const all = standing();
    const clashes: string[] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        if (overlap(all[i][1], all[j][1])) clashes.push(`${all[i][0]} × ${all[j][0]}`);
    expect(clashes).toEqual([]);
  });
  it("keeps the way in through the north door clear", () => {
    const lobby = { minX: DOOR.x - DOOR.w / 2, maxX: DOOR.x + DOOR.w / 2, minZ: AREA.z0, maxZ: AREA.z0 + 2.4 };
    expect(standing().filter(([, r]) => overlap(r, lobby)).map(([n]) => n)).toEqual([]);
  });
  it("keeps office furniture inside its rooms", () => {
    for (const p of PIECES.filter((p) => p.z < AREA.z0 - 2.5)) {
      const r = pieceRect(p, 0);
      expect(r.minZ >= OFFICES.z0 && r.maxZ <= OFFICES.z1 - OFFICES.corridor, p.id).toBe(true);
      expect(OFFICES.rooms.slice(1, -1).some((wall) => r.minX < wall && r.maxX > wall), p.id).toBe(false);
    }
  });
  it("names every desk differently", () => {
    expect(DESKS.length).toBeGreaterThan(10);
    expect(new Set(DESKS.map((d) => d.name)).size).toBe(DESKS.length);
  });
});

describe("editing the plan", () => {
  it("resizes the hall in whole bays and keeps everything inside it", () => {
    const small = applyPlan(resizePlan(defaultPlan(), 18, 12));
    expect([small.length, small.width]).toEqual([18, 12]);
    expect(AREA).toEqual({ x0: -9, x1: 9, z0: -6, z1: 6 });
    expect(COLUMNS).toHaveLength(2);
    for (const [name, r] of standing().filter(([n]) => !n.startsWith("column")))
      expect(r.minX >= AREA.x0 && r.maxX <= AREA.x1 && r.minZ >= AREA.z0 && r.maxZ <= AREA.z1, name).toBe(true);
    // a shelf against the south wall is still against it
    expect(locationHome("Main Warehouse", 0).z).toBeCloseTo(5.45);
    expect(resizePlan(defaultPlan(), 500, 1).length).toBe(48);
    expect(resizePlan(defaultPlan(), 500, 1).width).toBe(12);
  });
  it("keeps the same furniture when the room changes size", () => {
    const before = defaultPlan();
    const after = resizePlan(before, 36, 24);
    expect(after.pieces.map((p) => p.id)).toEqual(before.pieces.map((p) => p.id));
    expect(Object.keys(after.homes)).toEqual(Object.keys(before.homes));
  });
  it("turns the hall's contents a quarter turn and back again in four", () => {
    const start = resizePlan(defaultPlan(), 30, 18);
    const once = turnPlan(start);
    expect([once.length, once.width]).toEqual([18, 30]);
    const shelf = start.homes["Main Warehouse"], turned = once.homes["Main Warehouse"];
    expect([turned.x, turned.z, turned.rotation]).toEqual([-shelf.z, shelf.x, (shelf.rotation + 270) % 360]);
    const round = turnPlan(turnPlan(turnPlan(once)));
    const hall = (p: { id: string; z: number }) => !p.id.startsWith("office-") && !p.id.startsWith("corridor-");
    for (const p of start.pieces.filter(hall)) {
      const q = round.pieces.find((x) => x.id === p.id)!;
      expect(q.x, p.id).toBeCloseTo(p.x, 1);
      expect(q.z, p.id).toBeCloseTo(p.z, 1);
      expect(Math.cos(q.rot), p.id).toBeCloseTo(Math.cos(p.rot), 5);
    }
  });
  it("mirrors left and right", () => {
    const m = mirrorPlan(defaultPlan());
    expect(m.doorX).toBe(3);
    expect(m.homes["Lab A"]).toEqual({ x: 11.45, z: -3, rotation: 270 });
    expect(mirrorPlan(m).homes).toEqual(defaultPlan().homes);
  });
  it("cleans up a plan from outside and rejects what is not one", () => {
    expect(sanitizePlan(null)).toBeNull();
    expect(sanitizePlan({ length: "big" })).toBeNull();
    const plan = sanitizePlan({
      length: 25,
      width: 13,
      doorX: 99,
      pieces: [
        { id: "a", kind: "workstation", x: 100, z: 0, rot: 0 },
        { id: "a", kind: "bench", x: 0, z: 0, rot: 0 },
        { id: "b", kind: "spaceship", x: 0, z: 0, rot: 0 },
        { id: "<script>", kind: "bench", x: 0, z: 0, rot: 0 },
      ],
      homes: { "Shelf A": { x: 0, z: 400, rotation: 95 }, broken: { x: "no" } },
    })!;
    expect([plan.length, plan.width]).toEqual([24, 12]);
    expect(plan.doorX).toBe(10.5);
    expect(plan.pieces).toEqual([{ id: "a", kind: "workstation", x: 10.95, z: 0, rot: 0 }]);
    expect(plan.homes).toEqual({ "Shelf A": { x: 0, z: 5.5, rotation: 90 } });
  });
});

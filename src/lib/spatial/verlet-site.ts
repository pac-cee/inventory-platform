// Verlet's floor (the open hall from the walk-through video, as on the 3D
// floor site in mockup/, localhost:5190), as plain data shared by the office
// map's 3D scene and its route finder. Metres; x runs east, z runs south,
// y is up; the hall's centre is the origin.
//
// Layout (2026-11-10, from the user): everything in the hall is turned 90°
// in place; the door is in the north yellow wall where Rack 1 and Shelf A
// stood; through it a corridor and four small offices, and beyond them the
// building's street face on KN 5 Rd.
//
// Inventory locations get a home on this floor: the piece of 5190 furniture
// that stands for that location (Shelf A on the robotics shelf unit, Rack 1
// on the wide rack, Main Warehouse on the pine wall shelving, ...). That piece
// is then drawn as the live, clickable shelf instead of as scenery.

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface Home {
  x: number;
  z: number;
  /** Degrees; 0 faces south (+z), 90 faces east (+x). */
  rotation: number;
}

/** The open hall (inner faces of the yellow walls, the glazing and the
 *  partition are a little inside these lines). */
export const AREA = { x0: -18, x1: 18, z0: -12, z1: 12 };
/** Behind the north wall: a corridor, then four small offices on the street side. */
export const OFFICES = { z0: -20, z1: -12, corridor: 2, rooms: [-18, -9, 0, 9, 18] };
/** Where a shelf centre may be placed or moved to. */
export const FLOOR_BOUNDS = { x0: -17.5, x1: 17.5, z0: -11.5, z1: 11.5 };
/** The glass double door in the north wall. */
export const DOOR = { x: -5.5, w: 2.0 };
/** Directions start just inside that door. */
export const ENTRANCE = { x: -5.5, z: -11 };
export const CEILING = 3.2;
export const GRID = 6;
/** Every object in the hall is turned this much in place (walls are not). */
export const TURN = Math.PI / 2;

/** Column centres on the 6 m grid. */
export const COLUMNS: [number, number][] = [];
for (let x = AREA.x0 + GRID; x < AREA.x1 - 0.1; x += GRID)
  for (let z = AREA.z0 + GRID; z < AREA.z1 - 0.1; z += GRID) COLUMNS.push([x, z]);
export const COLUMN_SIZE = 0.5;

// Footprints (w × d) of the furniture kit, from mockup/src/data.js.
export const KIT: Record<string, [number, number]> = {
  workstation: [1.6, 1.5], bench: [2.0, 1.0], printer: [0.8, 0.7],
  shelf: [1.3, 0.6], heavyRack: [2.6, 1.1], robotCell: [1.8, 1.4],
  amr: [0.8, 0.6], server: [0.7, 1.1], meeting: [2.8, 1.8], sofa: [2.0, 0.9],
  board: [1.9, 0.5], tv: [1.3, 0.6], plant: [0.6, 0.6], fan: [0.5, 0.5],
  bin: [0.6, 0.65], ladder: [0.6, 1.0], plywood: [2.6, 0.5],
  frontDesk: [2.6, 1.2], cases: [1.4, 0.9], pallet: [1.3, 1.1],
};

/** Department zone centres (the 5190 floor plan is written zone-local). */
const ZONES: Record<string, [number, number]> = {
  stock: [-11, -8],
  robo: [2, -8],
  hard: [13, -7],
  soft: [-5, 6],
  field: [13, 7],
};

export interface Piece {
  id: string;
  kind: string;
  x: number;
  z: number;
  /** Radians about y. */
  rot: number;
}

const turned = (rot: number) => Math.abs(Math.sin(rot)) > 0.5;
/** Footprint half-extents of a piece at its rotation. */
function halfSize(kind: string, rot: number): [number, number] {
  const [w, d] = KIT[kind];
  return turned(rot) ? [d / 2, w / 2] : [w / 2, d / 2];
}
/** Keep a piece's footprint inside the hall's walls. */
function inside(p: Piece): Piece {
  const [hw, hd] = halfSize(p.kind, p.rot), m = 0.25;
  return {
    ...p,
    x: Math.min(AREA.x1 - m - hw, Math.max(AREA.x0 + m + hw, p.x)),
    z: Math.min(AREA.z1 - m - hd, Math.max(AREA.z0 + m + hd, p.z)),
  };
}

/** Pieces moved after the turn so nothing overlaps and the door stays clear. */
const MOVED: Record<string, Partial<Piece>> = {
  reception: { x: -5.5, z: -7.6, rot: Math.PI },
  "robo-board": { x: 3.4, z: -9.0 },
  "stock-pallet": { x: -13.2, z: -4.6 },
  "stock-bin": { x: -11.6, z: -4.4 },
  "stock-desk": { x: -13.4, z: -6.6 },
};

/** The default floor plan from mockup/src/data.js, turned 90° in the hall,
 *  plus the small offices behind the north wall. */
export const PIECES: Piece[] = (() => {
  const out: Piece[] = [];
  const add = (zone: string, kind: string, x: number, z: number, rot = 0, id?: string) => {
    const [zx, zz] = ZONES[zone];
    const piece = inside({ id: id ?? `${zone}-${kind}-${out.length}`, kind, x: zx + x, z: zz + z, rot: rot + TURN });
    out.push(inside({ ...piece, ...MOVED[piece.id] }));
  };
  const R = Math.PI;
  const xs = [-11.2, -9.5, -5.2, -3.5, 1.0, 2.7, 7.0, 8.7];
  xs.forEach((x) => add("soft", "workstation", x, -3.4, R));
  xs.forEach((x) => add("soft", "workstation", x, 3.2, R));
  add("soft", "frontDesk", 11.2, -3.8, R, "reception");
  add("soft", "meeting", 11.4, 3.7);
  add("soft", "tv", -12.2, 0.2, Math.PI / 2);
  add("soft", "bin", -0.4, 0.9);
  add("soft", "fan", 4.0, 0.8);
  add("soft", "plant", 12.4, -0.6);
  add("robo", "shelf", -5.0, -3.45, 0, "robo-shelf-a");
  add("robo", "shelf", -3.6, -3.45, 0, "robo-shelf-b");
  [-0.8, 2.4, 4.9].forEach((x) => add("robo", "robotCell", x, -2.8));
  add("robo", "amr", 0.5, 1.2, 0.5);
  add("robo", "amr", 2.6, 3.0, -0.4);
  add("robo", "workstation", -4.6, 1.8, 0);
  add("robo", "workstation", 0.8, 2.6, 0);
  add("robo", "server", 5.2, 3.0, -Math.PI / 2);
  add("robo", "board", -5.6, -0.5, Math.PI / 2, "robo-board");
  [-4.2, -3.35, -2.5, -1.65].forEach((x) => add("hard", "printer", x, -4.4));
  add("hard", "bench", 1.4, -4.3, 0, "hard-bench-1");
  add("hard", "bench", 3.6, -4.3);
  add("hard", "shelf", 4.3, -1.6, -Math.PI / 2, "hard-shelf");
  add("hard", "bench", -2.6, 2.8);
  add("hard", "bench", -0.4, 2.8, R);
  add("hard", "workstation", 3.2, 2.4, 0);
  add("hard", "fan", -4.4, 0.2);
  add("hard", "plant", 4.4, 4.4);
  add("field", "cases", -3.2, -3.5, 0, "field-cases");
  add("field", "pallet", -0.8, -3.6);
  add("field", "shelf", 3.6, -4.1);
  add("field", "bench", 2.4, 1.8);
  add("field", "plywood", -3.4, 4.1, R);
  add("field", "ladder", 4.0, 3.6);
  add("stock", "heavyRack", 3.6, -3.35, 0, "stock-heavy-rack");
  add("stock", "bench", 0.4, -0.6, 0, "stock-bench-1");
  add("stock", "bench", 2.7, -0.6, 0, "stock-bench-2");
  add("stock", "workstation", 3.2, 2.6, R, "stock-desk");
  add("stock", "pallet", -4.4, 2.6, 0, "stock-pallet");
  add("stock", "bin", 6.3, 3.4, 0, "stock-bin");
  // The small offices: two desks each, a meeting room at the east end, plants
  // in the corridor. They sit outside the hall, so they are not turned.
  const roomZ = (OFFICES.z0 + OFFICES.z1 - OFFICES.corridor) / 2;
  OFFICES.rooms.slice(0, -1).forEach((x0, i) => {
    const cx = x0 + 4.5;
    if (i === OFFICES.rooms.length - 2) {
      out.push({ id: `office-${i}-meeting`, kind: "meeting", x: cx, z: roomZ, rot: 0 });
      out.push({ id: `office-${i}-board`, kind: "board", x: cx, z: OFFICES.z0 + 0.6, rot: R });
      return;
    }
    out.push({ id: `office-${i}-desk-a`, kind: "workstation", x: cx - 2, z: roomZ - 0.6, rot: R });
    out.push({ id: `office-${i}-desk-b`, kind: "workstation", x: cx + 2, z: roomZ - 0.6, rot: R });
    out.push({ id: `office-${i}-plant`, kind: "plant", x: x0 + 0.8, z: OFFICES.z0 + 0.8, rot: 0 });
  });
  [-14, 4, 13].forEach((x, i) => out.push({ id: `corridor-plant-${i}`, kind: "plant", x, z: OFFICES.z1 - 0.6, rot: 0 }));
  return out;
})();

/** Pine shelving (the stockroom's wall units); turned with the rest, so the
 *  one left as scenery now runs out from the north wall as a row. */
export const SHELVING = {
  bayW: 1.05,
  depth: 0.45,
  height: 2.4,
  levels: [0.12, 0.7, 1.28, 1.86],
  bays: 3,
  racks: [
    { id: "rack-a", name: "A", x: -17.5, z: -11.55, dir: "east" as "east" | "south" },
    { id: "rack-b", name: "B", x: -12.9, z: -11.55, dir: "south" as "east" | "south" },
    { id: "rack-c", name: "C", x: -17.55, z: -10.6, dir: "south" as "east" | "south" },
  ],
};

/** Inventory locations (by name) and the 5190 furniture they take the place of.
 *  Shelves that stood along a wall now stand out from it, turned 90°. */
const HOMES: Record<string, Home & { replaces?: string }> = {
  "Main Warehouse": { x: -15.9, z: -10.75, rotation: 90, replaces: "rack-a" },
  "Rack 1 · Level 2": { x: -9.9, z: -10.75, rotation: 90 },
  "Rack 1": { x: -7.4, z: -10.75, rotation: 90, replaces: "stock-heavy-rack" },
  "Shelf A": { x: -3.2, z: -10.75, rotation: 90, replaces: "robo-shelf-a" },
  "Shelf B": { x: -0.2, z: -10.75, rotation: 270, replaces: "robo-shelf-b" },
  "Main Store": { x: -16.75, z: -9, rotation: 0, replaces: "rack-c" },
  "Cables box": { x: -16.75, z: -6.6, rotation: 0 },
  "Camera box": { x: -16.75, z: -3.6, rotation: 0 },
  "Front desk": { x: -2.6, z: -8.4, rotation: 90 },
  "Robotics Lab": { x: 5, z: -6.9, rotation: 90 },
  "Lab A": { x: 16.6, z: -8.6, rotation: 0, replaces: "hard-shelf" },
  "Field Kit": { x: 9.8, z: 3.8, rotation: 270, replaces: "field-cases" },
  Office: { x: -6.2, z: 10.75, rotation: 270 },
};
/** Open spots for locations the floor plan doesn't know yet. */
const SPARE: Home[] = [
  { x: -12.35, z: 10.75, rotation: 270 },
  { x: -0.15, z: 10.75, rotation: 270 },
  { x: 14.5, z: 6, rotation: 90 },
];
/** The tables the office map always shows, on the 5190 benches. */
export const TABLE_HOMES: Record<string, Home & { replaces: string }> = {
  "office-table-1": { x: -11.1, z: -8.6, rotation: 90, replaces: "stock-bench-1" },
  "office-table-2": { x: -9.4, z: -6.6, rotation: 90, replaces: "stock-bench-2" },
  "office-table-3": { x: 14.4, z: -10.8, rotation: 90, replaces: "hard-bench-1" },
};

export const isKnownLocation = (name: string) => name in HOMES;

/** Where a location's shelf stands by default; `spare` counts unknown ones so far. */
export function locationHome(name: string, spare: number): Home {
  const home = HOMES[name];
  if (home) return { x: home.x, z: home.z, rotation: home.rotation };
  if (spare < SPARE.length) return { ...SPARE[spare] };
  return { x: -12 + ((spare - SPARE.length) % 8) * 3, z: -2.5, rotation: 0 };
}

/** 5190 pieces and wall racks that are drawn as live shelves or tables instead. */
export const REPLACED = new Set<string>([
  ...Object.values(HOMES).flatMap((h) => (h.replaces ? [h.replaces] : [])),
  ...Object.values(TABLE_HOMES).map((h) => h.replaces),
]);

/** Footprint of a piece, padded for walking clearance. */
export function pieceRect(p: Piece, pad = 0.2): Rect {
  const [hw, hd] = halfSize(p.kind, p.rot);
  return { minX: p.x - hw - pad, maxX: p.x + hw + pad, minZ: p.z - hd - pad, maxZ: p.z + hd + pad };
}

/** Everything fixed on the floor that a route must walk round. */
export function siteObstacles(pad = 0.2): Rect[] {
  const rects = PIECES.filter((p) => !REPLACED.has(p.id) && p.z > AREA.z0).map((p) => pieceRect(p, pad));
  const c = COLUMN_SIZE / 2 + pad;
  for (const [x, z] of COLUMNS) rects.push({ minX: x - c, maxX: x + c, minZ: z - c, maxZ: z + c });
  for (const r of SHELVING.racks) {
    if (REPLACED.has(r.id)) continue;
    const len = SHELVING.bayW * SHELVING.bays;
    rects.push(
      r.dir === "east"
        ? { minX: r.x - pad, maxX: r.x + len + pad, minZ: r.z - SHELVING.depth / 2 - pad, maxZ: r.z + SHELVING.depth / 2 + pad }
        : { minX: r.x - SHELVING.depth / 2 - pad, maxX: r.x + SHELVING.depth / 2 + pad, minZ: r.z - pad, maxZ: r.z + len + pad },
    );
  }
  return rects;
}

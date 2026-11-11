// Verlet's floor as one editable plan, shared by the office map's 3D scene,
// its route finder and the room editor. Metres; x runs east, z runs south,
// y is up; the hall's centre is the origin.
//
// A FloorPlan says how big the hall is, where the door is, and where every
// piece of furniture and every inventory shelf stands. `applyPlan` makes a
// plan the live one: the constants below (AREA, COLUMNS, PIECES, ...) are
// updated in place, so everything that reads them draws the new room.
//
// The room itself is fixed in character: yellow walls north and west, glazing
// south, a frosted partition east, columns on a 6 m grid, and behind the north
// wall a corridor and a row of small offices. The default is 24 m × 24 m
// (2026-11-11: the first estimate, 36 m long, was far too large).

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
export interface Piece {
  id: string;
  /** A furniture kit kind, see KIT. */
  kind: string;
  x: number;
  z: number;
  /** Radians about y. */
  rot: number;
}
export interface FloorPlan {
  version: 1;
  /** The hall, in metres: length runs east-west (x), width north-south (z).
   *  Both are whole column bays (multiples of GRID). */
  length: number;
  width: number;
  /** Centre of the glass door along the north wall. */
  doorX: number;
  /** Every piece of furniture; the desks are the ones of kind "workstation". */
  pieces: Piece[];
  /** Where inventory locations stand, by location name. */
  homes: Record<string, Home>;
  /** The office map's work tables, by id. */
  tables: Record<string, Home>;
}

export const GRID = 6;
export const CEILING = 3.2;
export const COLUMN_SIZE = 0.5;
/** Smallest and largest hall the editor allows, in metres. */
export const PLAN_LIMITS = { length: [12, 48], width: [12, 36] } as const;
const OFFICE_DEPTH = 8;
const CORRIDOR = 2;
const DOOR_WIDTH = 2;

// Footprints (w × d) of the furniture kit, from mockup/src/data.js.
export const KIT: Record<string, [number, number]> = {
  workstation: [1.6, 1.5], bench: [2.0, 1.0], printer: [0.8, 0.7],
  shelf: [1.3, 0.6], heavyRack: [2.6, 1.1], robotCell: [1.8, 1.4],
  amr: [0.8, 0.6], server: [0.7, 1.1], meeting: [2.8, 1.8], sofa: [2.0, 0.9],
  board: [1.9, 0.5], tv: [1.3, 0.6], plant: [0.6, 0.6], fan: [0.5, 0.5],
  bin: [0.6, 0.65], ladder: [0.6, 1.0], plywood: [2.6, 0.5],
  frontDesk: [2.6, 1.2], cases: [1.4, 0.9], pallet: [1.3, 1.1],
};
/** What each kind is called in the editor. */
export const KIT_LABELS: Record<string, string> = {
  workstation: "Desk", bench: "Workbench", printer: "3D printer", shelf: "Shelf unit",
  heavyRack: "Heavy rack", robotCell: "Robot cell", amr: "Mobile robot", server: "Server rack",
  meeting: "Meeting table", sofa: "Sofa", board: "Whiteboard", tv: "Screen", plant: "Plant",
  fan: "Fan", bin: "Bin", ladder: "Ladder", plywood: "Plywood sheets", frontDesk: "Front desk",
  cases: "Flight cases", pallet: "Pallet",
};

// ---- geometry of a hall of a given size ---------------------------------------
interface Geometry {
  area: { x0: number; x1: number; z0: number; z1: number };
  offices: { z0: number; z1: number; corridor: number; rooms: number[] };
}
function geometry(length: number, width: number): Geometry {
  const hx = length / 2, hz = width / 2;
  const count = Math.max(2, Math.round(length / 8));
  const rooms = Array.from({ length: count + 1 }, (_, i) => Math.round((-hx + (length * i) / count) * 2) / 2);
  return {
    area: { x0: -hx, x1: hx, z0: -hz, z1: hz },
    offices: { z0: -hz - OFFICE_DEPTH, z1: -hz, corridor: CORRIDOR, rooms },
  };
}
const turned = (rot: number) => Math.abs(Math.sin(rot)) > 0.5;
/** Footprint half-extents of a kit piece at its rotation (radians). */
export function halfSize(kind: string, rot: number): [number, number] {
  const [w, d] = KIT[kind] ?? [1, 1];
  return turned(rot) ? [d / 2, w / 2] : [w / 2, d / 2];
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Keep a piece's footprint inside the walls: in the hall, or behind the
 *  north wall (corridor and small offices), never in the wall between them. */
function clampInto<T extends { x: number; z: number }>(p: T, kind: string, rot: number, g: Geometry): T {
  const [hw, hd] = halfSize(kind, rot), m = 0.25;
  const x = clamp(p.x, g.area.x0 + m + hw, g.area.x1 - m - hw);
  const z =
    p.z >= g.area.z0
      ? clamp(p.z, g.area.z0 + m + hd, g.area.z1 - m - hd)
      : clamp(p.z, g.offices.z0 + m + hd, g.offices.z1 - m - hd);
  return { ...p, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
}
const snapSize = (v: number, [lo, hi]: readonly [number, number]) =>
  clamp(Math.round(v / GRID) * GRID, lo, hi);
const quarter = (rot: number) => {
  const q = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(q - rot) < 0.01 ? q : rot;
};
const degrees = (rot: number) => (((Math.round((rot * 180) / Math.PI / 90) * 90) % 360) + 360) % 360;

// ---- the default plan ---------------------------------------------------------
/** Two desks in each small office, a meeting table in the last, plants. */
function officePieces(g: Geometry): Piece[] {
  const out: Piece[] = [];
  const roomZ = (g.offices.z0 + g.offices.z1 - g.offices.corridor) / 2;
  const last = g.offices.rooms.length - 2;
  g.offices.rooms.slice(0, -1).forEach((x0, i) => {
    const cx = (x0 + g.offices.rooms[i + 1]) / 2;
    if (i === last) {
      out.push({ id: `office-${i}-meeting`, kind: "meeting", x: cx, z: roomZ, rot: 0 });
      out.push({ id: `office-${i}-board`, kind: "board", x: cx, z: g.offices.z0 + 0.6, rot: Math.PI });
      return;
    }
    out.push({ id: `office-${i}-desk-a`, kind: "workstation", x: cx - 1.8, z: roomZ - 0.6, rot: Math.PI });
    out.push({ id: `office-${i}-desk-b`, kind: "workstation", x: cx + 1.8, z: roomZ - 0.6, rot: Math.PI });
    out.push({ id: `office-${i}-plant`, kind: "plant", x: x0 + 0.8, z: g.offices.z0 + 0.8, rot: 0 });
  });
  return out;
}

/** The floor as first drawn: a 24 m × 24 m hall. Stock by the door and along
 *  the south and east walls, software desks south-west, robotics in the middle
 *  east, hardware south-east. Meant to be corrected in the room editor. */
export function defaultPlan(): FloorPlan {
  const length = 24, width = 24, g = geometry(length, width);
  const R = Math.PI, Q = Math.PI / 2;
  const P = (id: string, kind: string, x: number, z: number, rot = 0): Piece => ({ id, kind, x, z, rot });
  const pieces: Piece[] = [
    // by the door
    P("reception", "frontDesk", -3, -7.8, R),
    P("soft-meeting", "meeting", -3, -2.5),
    P("lounge-sofa", "sofa", -8.5, -1, Q),
    // software: two rows of four desks, south-west
    ...[-9.85, -8.15, -3.85, -2.15].flatMap((x, i) => [
      P(`soft-workstation-${i}`, "workstation", x, 3),
      P(`soft-workstation-${i + 4}`, "workstation", x, 7.5),
    ]),
    // stockroom corner, north-west
    P("stock-heavy-rack", "heavyRack", -9.5, -11.2),
    P("stock-workstation-0", "workstation", -9.5, -5.5, R),
    P("stock-bin", "bin", -11.3, -7),
    P("stock-plywood", "plywood", -11.5, 0, Q),
    // robotics, middle east
    P("robo-cell-0", "robotCell", 3.5, -2.5),
    P("robo-cell-1", "robotCell", 8.5, -2.5),
    P("robo-amr-0", "amr", 2, 1.5, 0.5),
    P("robo-workstation-0", "workstation", 4, 3, R),
    P("robo-workstation-1", "workstation", 8.5, 3, R),
    P("robo-server", "server", 11, -2.5, -Q),
    P("robo-board", "board", 5, -4.6),
    // hardware, south-east
    P("hard-printer-0", "printer", 2.5, 5),
    P("hard-printer-1", "printer", 3.35, 5),
    P("hard-printer-2", "printer", 4.2, 5),
    P("hard-bench-0", "bench", 3.5, 7.5),
    P("hard-bench-1", "bench", 8, 7.6),
    P("hard-workstation-0", "workstation", 8.2, 5.2),
    // field kit, north-east
    P("field-cases", "cases", 10.6, -9.2),
    P("field-pallet", "pallet", 6.2, -9),
    P("field-ladder", "ladder", 11.3, -5),
    // odds and ends
    P("plant-sw", "plant", -11.3, 10.3),
    P("plant-ne", "plant", 11.3, -11.3),
    P("fan-east", "fan", 10.5, 0.6),
    P("corridor-plant-0", "plant", -9, g.offices.z1 - 0.6),
    P("corridor-plant-1", "plant", 3, g.offices.z1 - 0.6),
    ...officePieces(g),
  ];
  const S = 11.45;
  return {
    version: 1,
    length,
    width,
    doorX: -3,
    pieces: pieces.map((p) => clampInto(p, p.kind, p.rot, g)),
    homes: {
      // along the south wall, facing into the room
      "Main Warehouse": { x: 8.6, z: S, rotation: 180 },
      "Rack 1 · Level 2": { x: 6, z: S, rotation: 180 },
      "Rack 1": { x: 3.4, z: S, rotation: 180 },
      "Shelf A": { x: 0.8, z: S, rotation: 180 },
      "Shelf B": { x: -1.8, z: S, rotation: 180 },
      Office: { x: -4.4, z: S, rotation: 180 },
      // along the east partition
      "Main Store": { x: S, z: 8.6, rotation: 270 },
      "Cables box": { x: S, z: 6, rotation: 270 },
      "Camera box": { x: S, z: 3.4, rotation: 270 },
      // the rest
      "Lab A": { x: -S, z: -3, rotation: 90 },
      "Front desk": { x: -0.6, z: -8.5, rotation: 90 },
      "Robotics Lab": { x: 3.5, z: -S, rotation: 0 },
      "Field Kit": { x: 9, z: -S, rotation: 0 },
    },
    tables: {
      "office-table-1": { x: -9.5, z: -9, rotation: 0 },
      "office-table-2": { x: -7, z: -9, rotation: 0 },
      "office-table-3": { x: 8.5, z: -6.5, rotation: 0 },
    },
  };
}

// ---- reading a plan from outside (the API, a file someone loads) -----------------
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
function readHomes(raw: unknown, g: Geometry, limit: number): Record<string, Home> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Home> = {};
  for (const [name, h] of Object.entries(raw as Record<string, Partial<Home>>).slice(0, limit)) {
    if (!h || !finite(h.x) || !finite(h.z) || !finite(h.rotation) || name.length > 120) continue;
    out[name] = {
      x: clamp(h.x, g.area.x0 + 0.5, g.area.x1 - 0.5),
      z: clamp(h.z, g.area.z0 + 0.5, g.area.z1 - 0.5),
      rotation: (((Math.round(h.rotation / 90) * 90) % 360) + 360) % 360,
    };
  }
  return out;
}
/** A safe copy of a plan from outside, or null when it is not a plan at all.
 *  Sizes snap to whole bays, furniture is kept inside the walls, unknown kinds
 *  and broken rows are dropped. */
export function sanitizePlan(raw: unknown): FloorPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<FloorPlan>;
  if (!finite(r.length) || !finite(r.width) || !Array.isArray(r.pieces)) return null;
  const length = snapSize(r.length, PLAN_LIMITS.length), width = snapSize(r.width, PLAN_LIMITS.width);
  const g = geometry(length, width);
  const seen = new Set<string>();
  const pieces: Piece[] = [];
  for (const p of r.pieces.slice(0, 400) as Partial<Piece>[]) {
    if (!p || typeof p.id !== "string" || !/^[\w-]{1,64}$/.test(p.id) || seen.has(p.id)) continue;
    if (typeof p.kind !== "string" || !(p.kind in KIT) || !finite(p.x) || !finite(p.z) || !finite(p.rot)) continue;
    seen.add(p.id);
    const rot = quarter(p.rot);
    pieces.push(clampInto({ id: p.id, kind: p.kind, x: p.x, z: p.z, rot }, p.kind, rot, g));
  }
  const half = length / 2 - DOOR_WIDTH / 2 - 0.5;
  return {
    version: 1,
    length,
    width,
    doorX: clamp(Math.round((finite(r.doorX) ? r.doorX : 0) * 2) / 2, -half, half),
    pieces,
    homes: readHomes(r.homes, g, 300),
    tables: readHomes(r.tables, g, 20),
  };
}

// ---- the live site: updated in place by applyPlan ---------------------------------
/** The open hall (inner faces of the walls are a little inside these lines). */
export const AREA = { x0: 0, x1: 0, z0: 0, z1: 0 };
/** Behind the north wall: a corridor, then small offices on the street side. */
export const OFFICES = { z0: 0, z1: 0, corridor: CORRIDOR, rooms: [] as number[] };
/** Where a shelf centre may be placed or moved to. */
export const FLOOR_BOUNDS = { x0: 0, x1: 0, z0: 0, z1: 0 };
/** The glass double door in the north wall. */
export const DOOR = { x: 0, w: DOOR_WIDTH };
/** Directions start just inside that door. */
export const ENTRANCE = { x: 0, z: 0 };
/** Column centres on the 6 m grid. */
export const COLUMNS: [number, number][] = [];
/** Every piece of furniture on the floor. */
export const PIECES: Piece[] = [];
/** A desk people sit at: a workstation of the plan. */
export interface DeskHome extends Home {
  id: string;
  name: string;
}
export const DESKS: DeskHome[] = [];
/** The tables the office map always shows. */
export const TABLE_HOMES: Record<string, Home> = {};
const HOMES: Record<string, Home> = {};
let active: FloorPlan;

const ZONE_NAMES: Record<string, string> = {
  soft: "Software", robo: "Robotics", hard: "Hardware", stock: "Stockroom", field: "Field",
};
function deskHomes(pieces: Piece[]): DeskHome[] {
  const count: Record<string, number> = {};
  return pieces
    .filter((p) => p.kind === "workstation")
    .map((p) => {
      const office = p.id.match(/^office-(\d+)-desk-[ab]$/);
      const zone = office ? `Office ${Number(office[1]) + 1}` : (ZONE_NAMES[p.id.split("-")[0]] ?? "Hall");
      const n = (count[zone] = (count[zone] ?? 0) + 1);
      return { id: p.id, name: `${zone} desk ${n}`, x: p.x, z: p.z, rotation: degrees(p.rot) };
    });
}
const replace = <T extends object>(target: Record<string, T>, next: Record<string, T>) => {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(next));
};

/** Make `plan` the live floor (the default when null or not a plan). Returns
 *  the plan in force, cleaned up. */
export function applyPlan(plan: unknown): FloorPlan {
  const next = sanitizePlan(plan) ?? defaultPlan();
  const g = geometry(next.length, next.width);
  Object.assign(AREA, g.area);
  Object.assign(OFFICES, g.offices);
  Object.assign(FLOOR_BOUNDS, { x0: AREA.x0 + 0.5, x1: AREA.x1 - 0.5, z0: AREA.z0 + 0.5, z1: AREA.z1 - 0.5 });
  DOOR.x = next.doorX;
  Object.assign(ENTRANCE, { x: next.doorX, z: AREA.z0 + 1 });
  COLUMNS.length = 0;
  for (let x = AREA.x0 + GRID; x < AREA.x1 - 0.1; x += GRID)
    for (let z = AREA.z0 + GRID; z < AREA.z1 - 0.1; z += GRID) COLUMNS.push([x, z]);
  PIECES.length = 0;
  PIECES.push(...next.pieces.map((p) => ({ ...p })));
  DESKS.length = 0;
  DESKS.push(...deskHomes(next.pieces));
  replace(HOMES, next.homes);
  replace(TABLE_HOMES, next.tables);
  active = next;
  return next;
}
/** The plan in force. */
export const activePlan = () => active;
applyPlan(null);

/** Keep a kit piece's footprint inside the live floor's walls. */
export function clampPiece<T extends { x: number; z: number }>(p: T, kind: string, rot: number): T {
  return clampInto(p, kind, rot, { area: AREA, offices: OFFICES });
}

export const isKnownLocation = (name: string) => name in HOMES;
/** Where a location's shelf stands by default; `spare` counts the ones the
 *  plan does not name, which line up along the south wall and then mid-floor. */
export function locationHome(name: string, spare: number): Home {
  const home = HOMES[name];
  if (home) return { ...home };
  const perRow = Math.max(1, Math.floor((AREA.x1 - AREA.x0 - 3) / 2.6));
  const row = Math.floor(spare / perRow), col = spare % perRow;
  return {
    x: AREA.x0 + 2.4 + col * 2.6,
    z: row === 0 ? AREA.z1 - 0.55 : AREA.z1 - 0.55 - row * 3,
    rotation: 180,
  };
}

/** Footprint of a kit piece (rotation in radians), padded for walking clearance. */
export function pieceRect(p: { kind: string; x: number; z: number; rot: number }, pad = 0.2): Rect {
  const [hw, hd] = halfSize(p.kind, p.rot);
  return { minX: p.x - hw - pad, maxX: p.x + hw + pad, minZ: p.z - hd - pad, maxZ: p.z + hd + pad };
}
/** The columns, which a route must walk round whatever the furniture does. */
export function siteObstacles(pad = 0.2): Rect[] {
  const c = COLUMN_SIZE / 2 + pad;
  return COLUMNS.map(([x, z]) => ({ minX: x - c, maxX: x + c, minZ: z - c, maxZ: z + c }));
}

// ---- reshaping a plan -------------------------------------------------------------
/** A change applied to every position on the floor (rotation in degrees). */
export type Reshape = (p: Home) => Home;

/** Move a coordinate from a hall half-size to another: things within 2 m of a
 *  wall keep their distance from it, the middle of the room scales. */
function rescale(v: number, from: number, to: number): number {
  const d = from - Math.abs(v), s = Math.sign(v) || 1;
  if (d < 2) return s * (to - d);
  return from > 2 ? v * ((to - 2) / (from - 2)) : v;
}
/** How positions move when the hall goes from one size to another. Things in
 *  the small offices follow the north wall. */
export function resizer(from: Pick<FloorPlan, "length" | "width">, to: Pick<FloorPlan, "length" | "width">): Reshape {
  return (p) => ({
    x: rescale(p.x, from.length / 2, to.length / 2),
    z: p.z < -from.width / 2 ? p.z + (from.width - to.width) / 2 : rescale(p.z, from.width / 2, to.width / 2),
    rotation: p.rotation,
  });
}
/** A quarter turn clockwise (seen from above) of everything in the hall. */
export function turner(from: Pick<FloorPlan, "length" | "width">): Reshape {
  const offices = resizer(from, { length: from.width, width: from.length });
  return (p) =>
    p.z < -from.width / 2
      ? offices(p)
      : { x: -p.z, z: p.x, rotation: (p.rotation + 270) % 360 };
}
/** Left and right swapped. */
export const mirrorer: Reshape = (p) => ({ x: -p.x, z: p.z, rotation: (360 - p.rotation) % 360 });

/** A plan with every position passed through `reshape`, at a new size. */
export function reshapePlan(
  plan: FloorPlan,
  reshape: Reshape,
  size: Pick<FloorPlan, "length" | "width"> = plan,
  doorX = plan.doorX,
): FloorPlan {
  const homes = (r: Record<string, Home>) =>
    Object.fromEntries(Object.entries(r).map(([k, h]) => [k, reshape(h)]));
  const moved = {
    version: 1 as const,
    length: size.length,
    width: size.width,
    doorX,
    pieces: plan.pieces.map((p) => {
      const deg = (p.rot * 180) / Math.PI;
      const h = reshape({ x: p.x, z: p.z, rotation: deg });
      return { ...p, x: h.x, z: h.z, rot: p.rot + ((h.rotation - deg) * Math.PI) / 180 };
    }),
    homes: homes(plan.homes),
    tables: homes(plan.tables),
  };
  return sanitizePlan(moved)!;
}
/** The same floor in a hall of another size. */
export const resizePlan = (plan: FloorPlan, length: number, width: number) => {
  const size = { length: snapSize(length, PLAN_LIMITS.length), width: snapSize(width, PLAN_LIMITS.width) };
  return reshapePlan(plan, resizer(plan, size), size, rescale(plan.doorX, plan.length / 2, size.length / 2));
};
export const turnPlan = (plan: FloorPlan) =>
  reshapePlan(plan, turner(plan), { length: plan.width, width: plan.length });
export const mirrorPlan = (plan: FloorPlan) => reshapePlan(plan, mirrorer, plan, -plan.doorX);

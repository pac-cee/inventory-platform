// In-browser stand-in for the inventory API, built from the app's own mock
// fixtures (src/fixtures.js is generated from src/lib/api/mock/fixtures.json).
//
// Rules mirror docs/SPEC.md and src/lib/roles.ts: a person can't return more
// than they hold, Damaged keeps units in the total, Lost removes them, Repair
// needs inventory management, payment approval is admin or cashier.
//
// New in this mockup (prototype only, saved on this device): departments,
// who belongs to which, who leads them, and each department's floor layout.
import * as F from "./fixtures.js";
import { BUILDINGS } from "./site.js";

const STORE_KEY = "verlet-floor-v5";

// ---- SKU rule from docs/SPEC.md §1 ------------------------------------------
export function skuPrefix(type) {
  const words = type.toLowerCase().replace(/\//g, " ").split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return "itm";
  if (words.length >= 3) return words.slice(0, 5).map((w) => w[0]).join("");
  if (words.length === 2) return words[0].slice(0, 3) + words[1].slice(0, 2);
  const w = words[0];
  const squeezed = w[0] + w.slice(1).replace(/[aeiou]/g, "");
  return (squeezed.length < 3 ? w : squeezed).slice(0, 5);
}

// fixture ids, by name, so the layout below reads plainly
const LOC = Object.fromEntries(F.LOCATIONS.map((l) => [l.name, l.id]));
const PERSON = Object.fromEntries(F.PEOPLE.map((p) => [p.name, p.id]));

// ---- the stockroom's racks: Main Warehouse › Rack A1 › Rack A1 · Level 3 › Box A-1-3-L
// The fixtures keep Main Warehouse stock at the area itself; the mockup gives it
// shelves so it has somewhere to stand. These shelves are a sample layout.
export const RACKS = ["A", "B", "C"];
export const BAYS = 3;
export const LEVELS = 4;
export const SIDES = ["L", "R"];

function rackLocations() {
  const out = [];
  const wh = LOC["Main Warehouse"];
  for (const r of RACKS) for (let b = 1; b <= BAYS; b++) {
    const shelf = `sh-${r}${b}`;
    out.push({ id: shelf, name: `Rack ${r}${b}`, parent_id: wh, kind: "shelf", sample: true });
    for (let l = 1; l <= LEVELS; l++) {
      const lev = `lv-${r}${b}${l}`;
      out.push({ id: lev, name: `Rack ${r}${b} · Level ${l}`, parent_id: shelf, kind: "level", sample: true });
      for (const s of SIDES) out.push({ id: `bin-${r}-${b}-${l}-${s}`, name: `Box ${r}-${b}-${l}-${s}`, parent_id: lev, kind: "box", code: `${r}-${b}-${l}-${s}`, sample: true });
    }
  }
  return out;
}

// Illustrative parts that fill the sample racks (marked "sample" in the UI)
const SAMPLE_ITEMS = [
  ["Motor Driver", "TMC2209", "V1.3", "UART, silent stepper driver"],
  ["Linear Rail", "MGN12H 300mm", "MGN12H", "Carriage included"],
  ["Lead Screw", "T8 400mm", "T8x8", "With brass nut"],
  ["Aluminium Extrusion", "2020 500mm", "2020-V", "V-slot, black"],
  ["Timing Belt", "GT2 6mm", "GT2-6", "5m roll"],
  ["Pulley", "GT2 20T", "GT2-20T-5", "5mm bore"],
  ["Buck Converter", "LM2596", "LM2596S", "3A adjustable"],
  ["Sensor", "HC-SR04", "HC-SR04", "Ultrasonic, 2–400cm"],
  ["Sensor", "TCRT5000", "TCRT5000", "IR line sensor"],
  ["Limit Switch", "Micro Roller", "KW12-3", "Roller lever, NO/NC"],
  ["Wheel", "65mm Rubber", "TT-65", "For TT gear motor"],
  ["Gear Motor", "TT 1:48", "TT-48", "3–6V"],
  ["Connector", "JST-XH 2.54", "XH-KIT", "2–6 pin assortment"],
  ["Heat Shrink", "Assorted Kit", "HS-560", "560 pcs, 2:1"],
  ["Solder Wire", "0.8mm 60/40", "SW-08", "250g reel"],
  ["Breadboard", "830 Point", "MB-102", "With power rails"],
  ["Jumper Wires", "M-M 20cm", "JW-MM20", "Pack of 40"],
  ["Nyloc Nuts", "M4", "DIN985", "Stainless, bag of 100"],
  ["Servo", "MG996R", "MG996R", "Metal gear, 11 kg·cm"],
  ["Bearing", "608ZZ", "608ZZ", "8×22×7mm, shielded"],
];

// Main Warehouse stock from the fixtures, placed on the sample racks
const WAREHOUSE_BINS = {
  "Cable|Patch Lead 3m": "bin-A-1-1-L", "Cable|Patch Lead 5m": "bin-A-1-1-R", "Stepper Motor|NEMA 17": "bin-A-2-2-L",
  "PLA Filament|Black Spool": "bin-B-1-1-L", "Socket Screws|M3x10": "bin-A-3-1-R",
};

// ---- departments: which building, which inventory areas, who leads ----------
const DEPARTMENTS = [
  { id: "stock", name: "Stockroom", type: "stockroom", building: "b-store", areas: [LOC["Main Warehouse"], LOC["Main Store"]], accent: "#ff5c95", lead: PERSON["Aline Uwase"] },
  { id: "soft", name: "Software", type: "office", building: "b-office", areas: [LOC["Office"]], accent: "#7cb7ff", lead: null },
  { id: "hard", name: "Hardware", type: "lab", building: "b-lab", areas: [LOC["Lab A"]], accent: "#e6b44a", lead: null },
  { id: "robo", name: "Robotics station", type: "robotics", building: "b-robotics", areas: [LOC["Robotics Lab"]], accent: "#5fbf7f", lead: null },
  { id: "field", name: "Field Kit bay", type: "field", building: "b-field", areas: [LOC["Field Kit"]], accent: "#c79bff", lead: null },
];
// default homes — the admin can change every one of these
const HOME = {
  "Verlet Admin": "soft", "Aline Uwase": "stock", "Diane Mukamana": "soft",
  "Eric Mugisha": "hard", "Grace Ingabire": "robo", "Jean Habimana": "robo",
};

// ---- the furniture kit: footprint (w × d metres) and which types may use it
export const KIT = {
  workstation: { label: "Desk", w: 1.6, d: 1.5, types: "*" },
  bench: { label: "Workbench", w: 2.0, d: 1.0, types: ["lab", "robotics", "field", "stockroom"] },
  printer: { label: "3D printer", w: 0.8, d: 0.7, types: ["lab", "robotics"] },
  shelf: { label: "Shelving", w: 1.3, d: 0.6, types: "*" },
  heavyRack: { label: "Wide shelving", w: 2.6, d: 1.1, types: ["stockroom", "field"] },
  robotCell: { label: "Robot desk", w: 1.8, d: 1.4, types: ["robotics", "lab"] },
  amr: { label: "Mobile robot", w: 0.8, d: 0.6, types: ["robotics"] },
  server: { label: "Server rack", w: 0.7, d: 1.1, types: ["office", "robotics", "lab"] },
  meeting: { label: "Meeting table", w: 2.8, d: 1.8, types: ["office", "lab", "robotics"] },
  sofa: { label: "Sofa", w: 2.0, d: 0.9, types: ["office"] },
  board: { label: "Whiteboard", w: 1.9, d: 0.5, types: "*" },
  tv: { label: "TV stand", w: 1.3, d: 0.6, types: "*" },
  plant: { label: "Plant", w: 0.6, d: 0.6, types: "*" },
  fan: { label: "Standing fan", w: 0.5, d: 0.5, types: "*" },
  bin: { label: "Wheelie bin", w: 0.6, d: 0.65, types: "*" },
  ladder: { label: "Step ladder", w: 0.6, d: 1.0, types: ["field", "stockroom", "lab"] },
  plywood: { label: "Plywood sheets", w: 2.6, d: 0.5, types: ["field", "stockroom", "lab"] },
  frontDesk: { label: "Front desk", w: 2.6, d: 1.2, types: ["office"] },
  cases: { label: "Flight cases", w: 1.4, d: 0.9, types: ["field", "robotics", "stockroom"] },
  pallet: { label: "Pallet", w: 1.3, d: 1.1, types: ["stockroom", "field"] },
};
export const kitFor = (type) => Object.entries(KIT).filter(([, k]) => k.types === "*" || k.types.includes(type)).map(([kind]) => kind);

// default floor plans, in department-local metres (origin = building centre)
function defaultPieces() {
  const P = [];
  const add = (dept, kind, x, z, rot = 0, extra = {}) => P.push({ id: `pc-${P.length + 1}`, dept, kind, x, z, rot, ...extra });
  const R = Math.PI;
  // Dev rows (26 × 12): two rows of white-top desks facing the windows, red banquet chairs
  const xs = [-11.2, -9.5, -5.2, -3.5, 1.0, 2.7, 7.0, 8.7];
  xs.forEach((x, i) => add("soft", "workstation", x, -3.4, R, i === 0 ? { owner: PERSON["Verlet Admin"] } : i === 1 ? { owner: PERSON["Diane Mukamana"] } : {}));
  xs.forEach((x) => add("soft", "workstation", x, 3.2, R));
  add("soft", "frontDesk", 11.2, -3.8, R, { location: LOC["Front desk"] });
  add("soft", "meeting", 11.4, 3.7);
  add("soft", "tv", -12.2, 0.2, Math.PI / 2);
  add("soft", "bin", -0.4, 0.9); add("soft", "fan", 4.0, 0.8); add("soft", "plant", 12.4, -0.6);
  // Robotics desks (12 × 8): SO-100 arm desks, Shelf A/B, mobile robots
  add("robo", "shelf", -5.0, -3.45, 0, { location: LOC["Shelf A"] });
  add("robo", "shelf", -3.6, -3.45, 0, { location: LOC["Shelf B"] });
  [-0.8, 2.4, 4.9].forEach((x) => add("robo", "robotCell", x, -2.8));
  add("robo", "amr", 0.5, 1.2, 0.5); add("robo", "amr", 2.6, 3.0, -0.4);
  add("robo", "workstation", -4.6, 1.8, 0, { owner: PERSON["Grace Ingabire"] });
  add("robo", "workstation", 0.8, 2.6, 0, { owner: PERSON["Jean Habimana"] });
  add("robo", "server", 5.2, 3.0, -Math.PI / 2);
  add("robo", "board", -5.6, -0.5, Math.PI / 2);
  // Electronics & printing (10 × 10): printer row on pine tables, benches, Lab A shelving
  [-4.2, -3.35, -2.5, -1.65].forEach((x) => add("hard", "printer", x, -4.4));
  add("hard", "bench", 1.4, -4.3); add("hard", "bench", 3.6, -4.3);
  add("hard", "shelf", 4.3, -1.6, -Math.PI / 2, { location: LOC["Lab A"] });
  add("hard", "bench", -2.6, 2.8); add("hard", "bench", -0.4, 2.8, R);
  add("hard", "workstation", 3.2, 2.4, 0, { owner: PERSON["Eric Mugisha"] });
  add("hard", "fan", -4.4, 0.2); add("hard", "plant", 4.4, 4.4);
  // Kit bay (10 × 10): flight cases (Field Kit), pallet, plywood, ladder
  add("field", "cases", -3.2, -3.5, 0, { location: LOC["Field Kit"] });
  add("field", "pallet", -0.8, -3.6);
  add("field", "shelf", 3.6, -4.1);
  add("field", "bench", 2.4, 1.8);
  add("field", "plywood", -3.4, 4.1, R); add("field", "ladder", 4.0, 3.6);
  // Stockroom corner (14 × 8): the shelving L itself comes from the location tree
  add("stock", "heavyRack", 3.6, -3.35, 0, { location: LOC["Rack 1"] });
  add("stock", "bench", 0.4, -0.6); add("stock", "bench", 2.7, -0.6);
  add("stock", "workstation", 3.2, 2.6, R, { owner: PERSON["Aline Uwase"] });
  add("stock", "pallet", -4.4, 2.6);
  add("stock", "bin", 6.3, 3.4);
  return P;
}

// ---- state -------------------------------------------------------------------
function freshState() {
  const items = [
    ...F.ITEMS.map((i) => ({ ...i, sample: false })),
    ...SAMPLE_ITEMS.map(([type, name, model, spec], i) => ({ id: `sx-${i + 1}`, type, name, model, spec, category: null, finishable: false, sample: true, sku: "" })),
  ];
  const seq = {};
  for (const it of items) { if (!it.sku) continue; const p = skuPrefix(it.type); const n = Number(it.sku.split("-").pop()) || 0; seq[p] = Math.max(seq[p] || 0, n); }
  for (const it of items) if (!it.sku) { const p = skuPrefix(it.type); seq[p] = (seq[p] || 0) + 1; it.sku = `vrlt-${p}-${String(seq[p]).padStart(3, "0")}`; }

  const locations = [...F.LOCATIONS.map((l) => ({ ...l })), ...rackLocations()];
  const whId = LOC["Main Warehouse"];
  const moveTo = {};   // fixture rows at the area → their sample bin
  const stock = F.STOCK.map((s) => {
    const it = F.ITEMS.find((i) => i.id === s.item_id);
    if (s.location_id === whId) { const bin = WAREHOUSE_BINS[`${it.type}|${it.name}`]; if (bin) { moveTo[s.item_id] = bin; return { ...s, location_id: bin }; } }
    return { ...s };
  });
  const used = new Set(stock.map((s) => s.location_id));
  let k = 0, n = 0;
  for (const r of RACKS) for (let b = 1; b <= BAYS; b++) for (let l = 1; l <= LEVELS; l++) for (const sd of SIDES) {
    const id = `bin-${r}-${b}-${l}-${sd}`; n++;
    if (used.has(id) || (n * 37) % 100 < 22) continue;
    const qty = [4, 6, 10, 12, 20, 24, 30, 50][(n * 13) % 8];
    const dmg = (n * 7) % 11 === 0 ? 1 + (n % 3) : 0;
    stock.push({ item_id: `sx-${(k++ % SAMPLE_ITEMS.length) + 1}`, location_id: id, quantity: qty, damaged: dmg, capacity: qty + dmg, sample: true });
  }
  let mid = 1;
  const movements = F.MOVEMENTS.map((m) => ({ ...m, id: mid++, location_id: m.location_id === whId && moveTo[m.item_id] ? moveTo[m.item_id] : m.location_id }));

  return {
    v: 5, me: null, items, locations, stock, movements, nextMovement: mid,
    people: F.PEOPLE.map((p) => ({ ...p, dept: HOME[p.name] || null })),
    departments: DEPARTMENTS.map((d) => ({ ...d })),
    pieces: defaultPieces(), nextPiece: 1000,
    budget: { ...F.BUDGET },
    payments: F.PAYMENTS.map((p) => ({ ...p, timeline: [[p.status === "rejected" ? "rejected" : p.status === "successful" ? "successful" : "requested", p.at]] })),
  };
}

let state = load();
const listeners = new Set();
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) { const s = JSON.parse(raw); if (s?.v === 5) return s; } } catch { /* blocked storage: start fresh */ }
  return freshState();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* non-fatal */ } }
function emit(evt) { save(); for (const fn of listeners) fn(evt); }

export const store = {
  get: () => state,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  reset() { const me = state.me; state = freshState(); state.me = me; emit({ type: "reset" }); },
  signIn(id) { state.me = id; emit({ type: "me" }); },
  me: () => state.people.find((p) => p.id === state.me) || null,
};

// ---- permissions (src/lib/roles.ts, plus the new department rules) ----------
export const isAdmin = (p) => p?.role === "admin";
export const canManageInventory = (p) => isAdmin(p) || p?.role === "stock_manager" || !!p?.manage;
export const canApprove = (p) => isAdmin(p) || !!p?.cashier;
export const canUsePayments = (p) => canApprove(p) || !!p?.pay;
export const canEditCampus = (p) => isAdmin(p);
export const canEditDept = (p, d) => isAdmin(p) || (!!d && d.lead === p?.id);
export const canMovePiece = (p, piece) => canEditDept(p, dept(piece.dept)) || (!!piece.owner && piece.owner === p?.id);
export const roleLabel = (r) => ({ admin: "Admin", stock_manager: "Stock manager", member: "Member" })[r] || r;

// ---- reads -----------------------------------------------------------------
export const item = (id) => state.items.find((i) => i.id === id);
export const loc = (id) => state.locations.find((l) => l.id === id);
export const person = (id) => state.people.find((p) => p.id === id);
export const personName = (id) => person(id)?.name || "—";
export const dept = (id) => state.departments.find((d) => d.id === id);
export const building = (id) => BUILDINGS.find((b) => b.id === id);
export const children = (id) => state.locations.filter((l) => l.parent_id === id);
export function path(id) {
  const out = [];
  for (let l = loc(id); l; l = l.parent_id ? loc(l.parent_id) : null) out.unshift(l.name);
  return out.join(" › ");
}
export function subtree(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of children(out[i])) out.push(c.id);
  return out;
}
export const stockAt = (locationId) => state.stock.filter((s) => s.location_id === locationId && s.capacity > 0);
export const stockUnder = (locationId) => { const ids = new Set(subtree(locationId)); return state.stock.filter((s) => ids.has(s.location_id) && s.capacity > 0); };
export const stockOf = (itemId) => state.stock.filter((s) => s.item_id === itemId && s.capacity > 0);
export function areaOf(locationId) { let l = loc(locationId); while (l?.parent_id) l = loc(l.parent_id); return l; }
export function deptOfLocation(locationId) { const a = areaOf(locationId); return state.departments.find((d) => d.areas.includes(a?.id)) || null; }
export const peopleIn = (deptId) => state.people.filter((p) => p.dept === deptId);
export const piecesIn = (deptId) => state.pieces.filter((p) => p.dept === deptId);
export function pieceOfLocation(locationId) {
  const chain = new Set();
  for (let l = loc(locationId); l; l = l.parent_id ? loc(l.parent_id) : null) chain.add(l.id);
  return state.pieces.find((p) => p.location && chain.has(p.location)) || null;
}
export const deskOf = (personId) => state.pieces.find((p) => p.kind === "workstation" && p.owner === personId) || null;
export function deptStats(d) {
  const rows = d.areas.flatMap((a) => stockUnder(a));
  return {
    units: rows.reduce((a, s) => a + s.quantity, 0),
    low: rows.filter((s) => s.quantity <= Math.max(2, s.capacity * 0.2)).length,
    damaged: rows.reduce((a, s) => a + s.damaged, 0),
    rows: rows.length, people: peopleIn(d.id).length,
  };
}

/** units a person currently holds of an item at a location (SPEC §4) */
export function held(itemId, locationId, personId) {
  let n = 0;
  for (const m of state.movements) {
    if (m.item_id !== itemId || m.location_id !== locationId || m.person_id !== personId || m.reversed) continue;
    if (m.kind === "take") n += -m.delta;
    else if (m.kind === "return") n -= m.delta;
    else if ((m.kind === "damaged" || m.kind === "lost") && m.from_holder) n -= m.from_holder;
  }
  return Math.max(0, n);
}
export const holders = (itemId, locationId) => state.people.map((p) => ({ person: p, n: held(itemId, locationId, p.id) })).filter((h) => h.n > 0);

/** Search matches type, name, model, SKU or specification (SPEC §1). */
export function search(q) {
  const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return state.items.map((it) => {
    const hay = `${it.type} ${it.name} ${it.model} ${it.sku} ${it.spec}`.toLowerCase();
    let score = it.sample ? 0 : 0.5;
    for (const t of terms) { const i = hay.indexOf(t); if (i < 0) return null; score += i === 0 ? 3 : hay[i - 1] === " " ? 2 : 1; }
    return { it, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).map((r) => r.it);
}

export function condition(s) {
  const total = s.capacity || 1;
  const pct = Math.round(((total - s.damaged) / total) * 100);
  let word = "Good", advice = "No action";
  if (pct < 100) { word = "Fair"; advice = "Book a repair for damaged units"; }
  if (pct < 85) { word = "Worn"; advice = "Repair or replace before the next build"; }
  if (pct < 70) { word = "Poor"; advice = "Replace — too many units out of service"; }
  return { pct, word, advice };
}
export function health(locationId, deep = false) {
  const rows = deep ? stockUnder(locationId) : stockAt(locationId);
  if (!rows.length) return null;
  const cap = rows.reduce((a, s) => a + s.capacity, 0), dmg = rows.reduce((a, s) => a + s.damaged, 0);
  return cap ? (cap - dmg) / cap : 1;
}

// ---- stock writes (the rules live here, like the Express guards) -----------
export class RuleError extends Error {}
const record = (m) => { const row = { id: state.nextMovement++, at: Date.now(), ...m }; state.movements.push(row); return row; };

export function move({ kind, itemId, locationId, qty, reason = "", attributeTo = null }) {
  const me = store.me();
  if (!me) throw new RuleError("Sign in first.");
  const s = state.stock.find((x) => x.item_id === itemId && x.location_id === locationId);
  if (!s) throw new RuleError("That item isn't stocked here.");
  qty = Math.floor(Number(qty));
  if (!(qty > 0)) throw new RuleError("Enter a quantity of at least 1.");
  const who = attributeTo || me.id;
  const mine = held(itemId, locationId, who);
  const base = { item_id: itemId, location_id: locationId, person_id: who, actor_id: me.id };
  if (kind === "take") {
    if (qty > s.quantity) throw new RuleError(`Only ${s.quantity} on the shelf.`);
    s.quantity -= qty;
    emit({ type: "move", row: record({ ...base, kind, delta: -qty, damaged_delta: 0, note: reason }) }); return s;
  }
  if (kind === "return") {
    if (qty > mine) throw new RuleError(mine ? `You hold ${mine} — you can't return more than that.` : "You don't hold any of these.");
    s.quantity += qty;
    emit({ type: "move", row: record({ ...base, kind, delta: qty, damaged_delta: 0, note: reason }) }); return s;
  }
  if (kind === "damaged" || kind === "lost") {
    if (!reason.trim()) throw new RuleError(`Say why it was ${kind} — the report needs it.`);
    const fromHolder = Math.min(qty, mine), fromShelf = qty - fromHolder;
    if (fromShelf > s.quantity) throw new RuleError(`Only ${s.quantity} on the shelf and ${mine} held by ${personName(who)}.`);
    s.quantity -= fromShelf;
    if (kind === "damaged") s.damaged += qty; else s.capacity -= qty;
    emit({ type: "move", row: record({ ...base, kind, delta: -qty, damaged_delta: kind === "damaged" ? qty : 0, from_holder: fromHolder, note: reason }) }); return s;
  }
  if (kind === "repair") {
    if (!canManageInventory(me)) throw new RuleError("Repair is for inventory managers.");
    if (qty > s.damaged) throw new RuleError(`Only ${s.damaged} damaged here.`);
    if (!reason.trim()) throw new RuleError("Name the fault this repair clears.");
    s.damaged -= qty; s.quantity += qty;
    emit({ type: "move", row: record({ ...base, person_id: me.id, kind, delta: qty, damaged_delta: -qty, note: reason }) }); return s;
  }
  throw new RuleError("Unknown action.");
}

export function undo(movementId) {
  const me = store.me();
  const m = state.movements.find((x) => x.id === movementId);
  if (!m || m.reversed || ["initial", "undo", "finish"].includes(m.kind)) throw new RuleError("Nothing to undo.");
  if (m.actor_id && m.actor_id !== m.person_id && !canManageInventory(me)) throw new RuleError("Admin-attributed actions are only undoable by an admin.");
  const s = state.stock.find((x) => x.item_id === m.item_id && x.location_id === m.location_id);
  if (!s) throw new RuleError("That stock row is gone.");
  if (m.kind === "take") s.quantity += -m.delta;
  if (m.kind === "return") s.quantity -= m.delta;
  if (m.kind === "damaged") { s.damaged -= m.damaged_delta; s.quantity += m.damaged_delta - (m.from_holder || 0); }
  if (m.kind === "lost") { s.capacity += -m.delta; s.quantity += -m.delta - (m.from_holder || 0); }
  if (m.kind === "repair") { s.damaged += m.delta; s.quantity -= m.delta; }
  m.reversed = true;
  emit({ type: "move", row: record({ item_id: m.item_id, location_id: m.location_id, person_id: m.person_id, actor_id: me.id, kind: "undo", delta: 0, damaged_delta: 0, note: `Reversal of #${m.id}`, reversal_of: m.id }) });
}

// ---- departments & layout (prototype, saved on this device) ------------------
function guardDept(d) { if (!canEditDept(store.me(), d)) throw new RuleError("Only the admin or this department's lead can change its layout."); }
export function updatePiece(id, patch) {
  const pc = state.pieces.find((p) => p.id === id);
  if (!pc) return null;
  if (!canMovePiece(store.me(), pc)) throw new RuleError("You can only move your own desk here.");
  Object.assign(pc, patch);
  emit({ type: "layout", piece: pc });
  return pc;
}
export function addPiece(deptId, kind, x, z, rot = 0) {
  guardDept(dept(deptId));
  const pc = { id: `pc-${state.nextPiece++}`, dept: deptId, kind, x, z, rot };
  state.pieces.push(pc);
  emit({ type: "layout", piece: pc, added: true });
  return pc;
}
export function removePiece(id) {
  const pc = state.pieces.find((p) => p.id === id); if (!pc) return;
  guardDept(dept(pc.dept));
  if (pc.location) throw new RuleError("This one holds stock — move the stock before removing it.");
  state.pieces = state.pieces.filter((p) => p !== pc);
  emit({ type: "layout", removed: id });
}
export function restorePieces(deptId, snapshot) {
  guardDept(dept(deptId));
  state.pieces = [...state.pieces.filter((p) => p.dept !== deptId), ...snapshot.map((p) => ({ ...p }))];
  emit({ type: "layout", restored: deptId });
}
export function assignDesk(pieceId, personId) {
  const pc = state.pieces.find((p) => p.id === pieceId);
  guardDept(dept(pc.dept));
  for (const p of state.pieces) if (p.owner === personId) delete p.owner;
  if (personId) pc.owner = personId; else delete pc.owner;
  emit({ type: "layout", piece: pc });
}
export function updateDept(id, patch) {
  const me = store.me(), d = dept(id);
  const nameOnly = Object.keys(patch).every((k) => k === "name");
  if (!canEditCampus(me) && !(nameOnly && canEditDept(me, d))) throw new RuleError("Only the admin can change that.");
  if ("name" in patch && !String(patch.name).trim()) throw new RuleError("A department needs a name.");
  Object.assign(d, patch); emit({ type: "dept", id });
}
export function assignPerson(personId, deptId, lead = false) {
  if (!canEditCampus(store.me())) throw new RuleError("Only the admin assigns people to departments.");
  const p = person(personId); const was = p.dept; p.dept = deptId || null;
  if (was !== deptId) { const desk = deskOf(personId); if (desk) delete desk.owner; }
  for (const d of state.departments) if (d.lead === personId && (d.id !== deptId || !lead)) d.lead = null;
  if (lead && deptId) dept(deptId).lead = personId;
  emit({ type: "people", personId });
}

// ---- payments (MoMo mock mode) ----------------------------------------------
const spentBy = (personId, since) => state.payments.filter((p) => p.user_id === personId && p.status === "successful" && p.at >= since).reduce((a, p) => a + p.amount, 0);
export function limitsFor(personId) {
  const p = person(personId), now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return { daily: p.daily, monthly: p.monthly, perTxn: p.perTxn, spentToday: spentBy(personId, day), spentMonth: spentBy(personId, month) };
}
export function requestPayment({ amount, purpose, momo, receipt }) {
  const me = store.me();
  if (!canUsePayments(me)) throw new RuleError("You don't have payment permission — ask the admin.");
  amount = Math.round(Number(amount));
  if (!(amount > 0)) throw new RuleError("Enter an amount in RWF.");
  if (!purpose.trim()) throw new RuleError("Say what the money is for.");
  if (!/^(\+?250|0)?7[2389]\d{7}$/.test(momo.replace(/[\s-]/g, ""))) throw new RuleError("Use a Rwandan MoMo number, e.g. 0788 123 456.");
  const l = limitsFor(me.id);
  if (l.perTxn && amount > l.perTxn) throw new RuleError(`Over your per-transaction limit (${fmt(l.perTxn)} RWF).`);
  if (l.daily && l.spentToday + amount > l.daily) throw new RuleError(`That would pass today's limit (${fmt(l.daily)} RWF).`);
  if (l.monthly && l.spentMonth + amount > l.monthly) throw new RuleError(`That would pass your monthly limit (${fmt(l.monthly)} RWF).`);
  const p = { id: `px-${Date.now().toString(36)}`, user_id: me.id, amount, purpose, momo, receipt: receipt || null, status: "pending", at: Date.now(), timeline: [["requested", Date.now()]] };
  state.payments.unshift(p);
  emit({ type: "payment", p });
  return p;
}
export function decide(id, approve, note = "") {
  if (!canApprove(store.me())) throw new RuleError("Only an admin or cashier can approve payments.");
  const p = state.payments.find((x) => x.id === id);
  if (!p || p.status !== "pending") throw new RuleError("That request was already decided.");
  if (!approve) { p.status = "rejected"; p.note = note || "Rejected by Administrator"; p.timeline.push(["rejected", Date.now()]); return emit({ type: "payment", p }); }
  if (p.amount > state.budget.remaining) throw new RuleError("Not enough left in this month's budget.");
  p.status = "approved"; p.timeline.push(["approved", Date.now()]); emit({ type: "payment", p });
  setTimeout(() => { p.status = "disbursing"; p.timeline.push(["disbursing", Date.now()]); emit({ type: "payment", p }); }, 900);
  setTimeout(() => { p.status = "successful"; p.timeline.push(["successful", Date.now()]); state.budget.remaining -= p.amount; emit({ type: "payment", p }); }, 2600);
}

export function ledgerCsv(rows) {
  const head = "id,at,kind,item,sku,location,qty,damaged_delta,attributed_to,recorded_by,note";
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [head, ...rows.map((m) => { const it = item(m.item_id); return [m.id, new Date(m.at).toISOString(), m.kind, `${it.type} ${it.name}`, it.sku, path(m.location_id), m.delta, m.damaged_delta, personName(m.person_id), personName(m.actor_id || m.person_id), m.note].map(esc).join(","); })].join("\n");
}

export const fmt = (n) => Math.round(n).toLocaleString("en-US");
export function ago(t) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

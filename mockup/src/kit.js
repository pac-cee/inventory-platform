// Furniture kit: each kind is one merged, vertex-coloured geometry, so every
// desk on the campus (or every robot cell) is a single instanced draw call.
// Origin is the floor centre of the footprint; the working side faces +z.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const C = {
  oak: "#d6ad74", birch: "#f1efea", pine: "#d9b07a", gold: "#c9a24a", red: "#b3202b", wood2: "#c89a62", white: "#eeeae2", steel: "#8d939a", dark: "#2b2e33", black: "#17181b",
  screen: "#6f8fb3", keys: "#cfd3d8", seat: "#3a3f47", orange: "#e8762b", blue: "#2f6db3", green: "#4f8a3a",
  leaf: "#3f7d3a", leaf2: "#5a9a44", pot: "#b9b2a6", board: "#f6f6f2", fabric: "#5c6672", case: "#24262a",
  pallet: "#b48a5a", card: "#b98d5c", led: "#7cf0a8", yellow: "#e8c23a", rubber: "#222",
};

function part(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const g = geo.index ? geo : geo;
  g.rotateX(rx); g.rotateZ(rz); g.rotateY(ry);
  g.translate(x, y, z);
  const col = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
const box = (w, h, d, color, x, y, z, ry) => part(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, ry);
const cyl = (r, h, color, x, y, z, seg = 12, r2 = r) => part(new THREE.CylinderGeometry(r, r2, h, seg), color, x, y + h / 2, z);
const ball = (r, color, x, y, z, detail = 1) => part(new THREE.IcosahedronGeometry(r, detail), color, x, y, z);
const merge = (parts) => { const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g; };
const legs = (w, d, h, color, inset = 0.05, t = 0.05) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => box(t, h, t, color, sx * (w / 2 - inset), 0, sz * (d / 2 - inset)));

function banquet(x, z, ry = 0) {
  const p = [];
  for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) p.push(box(0.03, 0.46, 0.03, C.gold, x + dx, 0, z + dz));
  p.push(box(0.46, 0.07, 0.46, C.red, x, 0.46, z));
  const bx = x + Math.sin(ry) * 0.21, bz = z + Math.cos(ry) * 0.21;
  p.push(box(0.42, 0.5, 0.05, C.red, bx, 0.53, bz, ry), box(0.46, 0.04, 0.06, C.gold, bx, 1.02, bz, ry));
  return p;
}
function chair(x, z, ry = 0) {
  const p = [];
  p.push(cyl(0.28, 0.04, C.black, x, 0.02, z, 5));
  p.push(cyl(0.03, 0.38, C.steel, x, 0.06, z));
  p.push(box(0.5, 0.08, 0.48, C.seat, x, 0.44, z));
  const bx = x + Math.sin(ry) * 0.22, bz = z + Math.cos(ry) * 0.22;
  p.push(box(0.46, 0.5, 0.06, C.seat, bx, 0.56, bz, ry));
  return p;
}

const BUILD = {
  workstation() {
    // white laminate top on a pine frame, desktop PC, red banquet chair (as in the dev rows)
    return merge([
      box(1.6, 0.04, 0.8, C.birch, 0, 0.74, -0.35), ...legs(1.6, 0.8, 0.74, C.pine, 0.05, 0.06).map((g) => g.translate(0, 0, -0.35)),
      box(1.5, 0.05, 0.05, C.pine, 0, 0.66, -0.72),
      box(0.62, 0.38, 0.03, C.black, -0.2, 0.9, -0.62), box(0.58, 0.34, 0.005, C.screen, -0.2, 0.92, -0.6), box(0.05, 0.14, 0.05, C.dark, -0.2, 0.78, -0.64), box(0.24, 0.02, 0.18, C.dark, -0.2, 0.78, -0.64),
      box(0.2, 0.42, 0.42, C.black, 0.55, 0, -0.45), box(0.42, 0.015, 0.14, C.dark, -0.2, 0.78, -0.22),
      ...banquet(-0.2, 0.32, 0),
    ]);
  },
  bench() {
    const p = [box(2.0, 0.05, 0.8, C.oak, 0, 0.88, 0), ...legs(2.0, 0.8, 0.88, C.pine, 0.05, 0.06), box(1.9, 0.03, 0.7, C.pine, 0, 0.22, 0)];
    p.push(box(2.0, 1.0, 0.03, "#c9a878", 0, 0.93, -0.38));
    [[-0.7, C.orange], [-0.35, C.blue], [0, C.dark], [0.4, C.yellow], [0.75, C.steel]].forEach(([x, c], i) => p.push(box(0.08 + (i % 2) * 0.06, 0.22, 0.03, c, x, 1.3 + (i % 3) * 0.12, -0.35)));
    p.push(box(0.3, 0.12, 0.22, C.blue, -0.6, 0.93, -0.1), box(0.22, 0.08, 0.16, C.yellow, 0.5, 0.93, 0.05));
    return merge(p);
  },
  printer() {
    // big enclosed printer (silver shell, dark glass) on its own pine table
    return merge([
      box(0.8, 0.04, 0.7, C.pine, 0, 0.72, 0), ...legs(0.8, 0.7, 0.72, C.pine, 0.04, 0.05), box(0.72, 0.03, 0.62, C.pine, 0, 0.18, 0),
      box(0.56, 0.62, 0.56, "#c9ccd0", 0, 0.76, -0.02), box(0.44, 0.46, 0.005, "#1d2228", 0, 0.84, 0.262),
      box(0.56, 0.06, 0.56, C.dark, 0, 1.38, -0.02), box(0.1, 0.1, 0.01, C.led, 0.18, 1.28, 0.262),
      box(0.3, 0.25, 0.3, C.dark, -0.1, 0.21, 0),
    ]);
  },
  shelf() {
    // pine shelving unit, cardboard boxes and parts trays
    const p = [...[[-0.62, -0.25], [0.62, -0.25], [-0.62, 0.25], [0.62, 0.25]].map(([x, z]) => box(0.05, 2.2, 0.05, C.pine, x, 0, z)), box(1.28, 2.2, 0.02, C.wood2, 0, 0, -0.27)];
    [0.1, 0.62, 1.14, 1.66, 2.16].forEach((y, i) => {
      p.push(box(1.28, 0.03, 0.54, C.pine, 0, y, 0));
      if (i < 4) [-0.38, 0.05, 0.42].forEach((x, k) => { if ((i + k) % 4 !== 3) p.push(box(0.36, 0.26 + ((i * k) % 3) * 0.06, 0.4, (i + k) % 3 === 1 ? C.white : C.card, x, y + 0.03, 0)); });
    });
    return merge(p);
  },
  heavyRack() {
    // a wider pine unit (Main Store › Rack 1), level 2 holds the cables and camera boxes
    const p = [...[-1.28, 0, 1.28].flatMap((x) => [box(0.06, 2.4, 0.06, C.pine, x, 0, -0.5), box(0.06, 2.4, 0.06, C.pine, x, 0, 0.5)]), box(2.6, 2.4, 0.02, C.wood2, 0, 0, -0.52)];
    [0.12, 0.7, 1.28, 1.86, 2.36].forEach((y, i) => {
      p.push(box(2.6, 0.03, 1.02, C.pine, 0, y, 0));
      if (i < 4) [-0.85, 0, 0.82].forEach((x, k) => p.push(box(0.7, 0.32 + ((i + k) % 2) * 0.1, 0.8, (i + k) % 3 ? C.card : C.white, x, y + 0.03, 0)));
    });
    return merge(p);
  },
  robotCell() {
    const p = [box(1.2, 0.05, 0.8, C.dark, 0, 0.82, -0.1), ...legs(1.2, 0.8, 0.82, C.steel).map((g) => g.translate(0, 0, -0.1))];
    // SO-100-style desktop arm
    p.push(cyl(0.09, 0.08, C.white, -0.15, 0.87, -0.2, 16), cyl(0.05, 0.08, C.orange, -0.15, 0.95, -0.2, 12));
    p.push(part(new THREE.BoxGeometry(0.06, 0.34, 0.06), C.white, -0.15, 1.17, -0.2, 0, 0, 0.35));
    p.push(part(new THREE.BoxGeometry(0.05, 0.3, 0.05), C.orange, 0.03, 1.34, -0.2, 0, 0, -1.0));
    p.push(box(0.08, 0.06, 0.08, C.dark, 0.17, 1.2, -0.2), box(0.03, 0.08, 0.06, C.white, 0.2, 1.12, -0.2));
    p.push(box(0.12, 0.08, 0.12, C.yellow, 0.25, 0.87, 0.05), box(0.3, 0.2, 0.02, C.black, 0.35, 0.95, -0.42));
    // light-curtain posts and floor tape
    p.push(box(0.04, 1.2, 0.04, C.yellow, -0.82, 0, 0.62), box(0.04, 1.2, 0.04, C.yellow, 0.82, 0, 0.62));
    p.push(box(1.8, 0.005, 0.06, C.yellow, 0, 0.002, 0.68), box(1.8, 0.005, 0.06, C.yellow, 0, 0.002, -0.68), box(0.06, 0.005, 1.4, C.yellow, -0.88, 0.002, 0), box(0.06, 0.005, 1.4, C.yellow, 0.88, 0.002, 0));
    p.push(...chair(0.1, 0.35, 0));
    return merge(p);
  },
  amr() {
    return merge([
      box(0.7, 0.18, 0.5, C.white, 0, 0.08, 0), box(0.66, 0.04, 0.46, C.dark, 0, 0.26, 0),
      cyl(0.06, 0.08, C.black, 0, 0.3, 0.12, 16), box(0.2, 0.04, 0.02, C.led, 0, 0.16, 0.252),
      ...[[-0.3, -0.22], [0.3, -0.22], [-0.3, 0.22], [0.3, 0.22]].map(([x, z]) => part(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), C.rubber, x, 0.07, z, 0, 0, Math.PI / 2)),
    ]);
  },
  server() {
    const p = [box(0.6, 2.0, 1.0, C.black, 0, 0, 0)];
    for (let i = 0; i < 9; i++) p.push(box(0.54, 0.12, 0.01, i % 3 ? "#26292e" : "#30343a", 0, 0.2 + i * 0.19, 0.501), box(0.04, 0.02, 0.012, i % 4 ? C.led : "#ffb347", 0.2, 0.25 + i * 0.19, 0.502));
    return merge(p);
  },
  meeting() {
    const p = [box(2.4, 0.04, 1.1, C.white, 0, 0.72, 0), box(0.1, 0.7, 0.6, C.steel, -0.9, 0, 0), box(0.1, 0.7, 0.6, C.steel, 0.9, 0, 0)];
    [-0.75, 0, 0.75].forEach((x) => { p.push(...chair(x, 0.75, 0)); p.push(...chair(x, -0.75, Math.PI)); });
    return merge(p);
  },
  sofa() {
    return merge([box(2.0, 0.42, 0.85, C.fabric, 0, 0.06, 0), box(2.0, 0.42, 0.18, C.fabric, 0, 0.42, -0.34), box(0.16, 0.26, 0.85, C.fabric, -0.92, 0.42, 0), box(0.16, 0.26, 0.85, C.fabric, 0.92, 0.42, 0), box(1.9, 0.06, 0.8, C.dark, 0, 0, 0)]);
  },
  board() {
    return merge([box(1.8, 1.0, 0.03, C.board, 0, 0.9, 0), box(1.84, 0.04, 0.06, C.steel, 0, 0.88, 0.02), ...[-0.8, 0.8].map((x) => box(0.04, 1.9, 0.04, C.steel, x, 0, 0.02)), ...[-0.8, 0.8].map((x) => box(0.04, 0.03, 0.45, C.steel, x, 0, 0)),
      box(0.5, 0.02, 0.005, C.blue, -0.4, 1.6, 0.017), box(0.7, 0.02, 0.005, C.orange, 0.1, 1.45, 0.017), box(0.35, 0.02, 0.005, C.dark, -0.2, 1.3, 0.017)]);
  },
  plant() {
    return merge([cyl(0.2, 0.42, C.pot, 0, 0, 0, 14, 0.16), ball(0.32, C.leaf, 0, 0.85, 0, 1), ball(0.24, C.leaf2, 0.12, 1.08, 0.06, 1), ball(0.2, C.leaf, -0.12, 1.15, -0.05, 1)]);
  },
  frontDesk() {
    return merge([box(2.6, 1.08, 0.5, C.white, 0, 0, 0.3), box(2.6, 0.04, 0.6, C.oak, 0, 1.08, 0.3), box(2.4, 0.04, 0.7, C.birch, 0, 0.74, -0.25),
      box(0.55, 0.34, 0.03, C.black, -0.5, 0.88, -0.4), box(0.5, 0.3, 0.005, C.screen, -0.5, 0.9, -0.38), ...chair(-0.4, -0.15, Math.PI)]);
  },
  cases() {
    return merge([box(1.3, 0.42, 0.8, C.case, 0, 0.1, 0), box(1.25, 0.38, 0.78, "#30333a", 0.02, 0.52, 0.01), box(0.6, 0.32, 0.5, C.case, -0.2, 0.9, 0),
      ...[0.1, 0.52].map((y) => box(1.32, 0.03, 0.82, C.steel, 0, y + 0.18, 0)), ...[[-0.55, 0.35], [0.55, 0.35], [-0.55, -0.35], [0.55, -0.35]].map(([x, z]) => cyl(0.05, 0.1, C.rubber, x, 0, z))]);
  },
  tv() {
    // display on a rolling stand
    return merge([box(0.7, 0.04, 0.5, C.black, 0, 0.05, 0), ...[[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]].map(([x, z]) => cyl(0.04, 0.05, C.rubber, x, 0, z)),
      box(0.06, 1.5, 0.06, C.black, -0.2, 0.09, 0), box(0.06, 1.5, 0.06, C.black, 0.2, 0.09, 0), box(0.5, 0.03, 0.3, C.black, 0, 0.7, 0.05),
      box(1.3, 0.76, 0.06, C.black, 0, 1.1, 0.06), box(1.24, 0.7, 0.005, "#20262e", 0, 1.13, 0.092)]);
  },
  fan() {
    return merge([cyl(0.22, 0.03, C.black, 0, 0, 0, 16), cyl(0.02, 1.2, C.dark, 0, 0.03, 0, 8), cyl(0.24, 0.06, C.dark, 0, 1.24, 0.02, 20), part(new THREE.TorusGeometry(0.24, 0.012, 6, 24), C.dark, 0, 1.24 + 0.24, 0.06)]);
  },
  bin() {
    return merge([box(0.5, 0.82, 0.55, "#1f5fbf", 0, 0.06, 0), box(0.54, 0.06, 0.6, "#1a4f9f", 0, 0.88, 0.02), part(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), C.rubber, -0.2, 0.08, -0.24, 0, 0, Math.PI / 2), part(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), C.rubber, 0.2, 0.08, -0.24, 0, 0, Math.PI / 2)]);
  },
  ladder() {
    const p = [part(new THREE.BoxGeometry(0.05, 2.0, 0.04), C.steel, -0.25, 0.97, -0.25, 0, -0.25, 0), part(new THREE.BoxGeometry(0.05, 2.0, 0.04), C.steel, 0.25, 0.97, -0.25, 0, -0.25, 0),
      part(new THREE.BoxGeometry(0.05, 2.0, 0.04), C.steel, -0.25, 0.97, 0.25, 0, 0.25, 0), part(new THREE.BoxGeometry(0.05, 2.0, 0.04), C.steel, 0.25, 0.97, 0.25, 0, 0.25, 0)];
    for (let k = 0; k < 6; k++) p.push(box(0.5, 0.03, 0.08, C.steel, 0, 0.25 + k * 0.3, -0.42 + k * 0.07));
    return merge(p);
  },
  plywood() {
    // sheets leaning on the wall, as near the entrance in the video
    return merge([part(new THREE.BoxGeometry(1.22, 2.44, 0.02), "#d8b885", -0.6, 1.2, 0.1, 0, -0.12, 0), part(new THREE.BoxGeometry(1.22, 2.44, 0.02), "#cfae7a", 0.62, 1.2, 0.05, 0, -0.1, 0), part(new THREE.BoxGeometry(1.22, 2.44, 0.02), "#dcc090", 0.0, 1.2, -0.05, 0, -0.08, 0)]);
  },
  pallet() {
    const p = [box(1.2, 0.03, 1.0, C.pallet, 0, 0.12, 0), ...[-0.5, 0, 0.5].map((x) => box(0.12, 0.12, 1.0, C.pallet, x, 0, 0))];
    p.push(box(1.12, 0.62, 0.94, C.card, 0, 0.15, 0), box(1.0, 0.5, 0.8, C.card, 0.02, 0.77, 0.03), box(1.14, 0.02, 0.2, "#9a7448", 0, 0.77, 0));
    return merge(p);
  },
};

const cache = {};
export function kitGeometry(kind) { return (cache[kind] ||= BUILD[kind]()); }
export const KINDS = Object.keys(BUILD);

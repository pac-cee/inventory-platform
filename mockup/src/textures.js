// Procedural textures drawn on canvas at start-up: no image downloads, and
// every surface still gets grain, wear and a roughness response.
import * as THREE from "three";

function canvas(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

// cheap value noise, seeded so the room looks the same on every load
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function speckle(g, w, h, n, rand, cols, rMax) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(rand() * cols.length) | 0];
    const r = rand() * rMax;
    g.beginPath(); g.arc(rand() * w, rand() * h, r, 0, Math.PI * 2); g.fill();
  }
}

function tex(c, { repeat = [1, 1], srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Polished warehouse concrete with trowel swirls, stains and saw-cut joints. */
export function concrete() {
  const S = 1024, rand = rng(7);
  const [c, g] = canvas(S);
  g.fillStyle = "#77736d"; g.fillRect(0, 0, S, S);
  // large tonal blotches
  for (let i = 0; i < 70; i++) {
    const x = rand() * S, y = rand() * S, r = 60 + rand() * 220;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const v = rand() < 0.5 ? "rgba(60,58,55," : "rgba(170,166,158,";
    grd.addColorStop(0, v + (0.04 + rand() * 0.06) + ")"); grd.addColorStop(1, v + "0)");
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // trowel arcs
  g.lineWidth = 1.2;
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = `rgba(${rand() < 0.5 ? "255,255,255" : "0,0,0"},${0.025 + rand() * 0.03})`;
    g.beginPath(); g.arc(rand() * S, rand() * S, 40 + rand() * 160, rand() * 6, rand() * 6 + 1.4); g.stroke();
  }
  speckle(g, S, S, 9000, rand, ["rgba(40,38,36,.35)", "rgba(200,196,188,.3)", "rgba(110,106,100,.4)"], 1.4);
  // tyre scuffs
  for (let i = 0; i < 10; i++) {
    g.strokeStyle = `rgba(20,20,20,${0.05 + rand() * 0.06})`; g.lineWidth = 6 + rand() * 8;
    g.beginPath(); const y = rand() * S; g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + rand() * 80 - 40, S * 0.6, y + rand() * 80 - 40, S, y + rand() * 60 - 30); g.stroke();
  }
  // saw-cut joints every quarter
  g.strokeStyle = "rgba(30,28,26,.55)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(1, 0); g.lineTo(1, S); g.moveTo(0, 1); g.lineTo(S, 1); g.stroke();

  // roughness: polished patches are glossier
  const [rc, rg] = canvas(512);
  rg.fillStyle = "#a8a8a8"; rg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) {
    const x = rand() * 512, y = rand() * 512, r = 30 + rand() * 120;
    const grd = rg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(70,70,70,${0.3 + rand() * 0.4})`); grd.addColorStop(1, "rgba(70,70,70,0)");
    rg.fillStyle = grd; rg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(rg, 512, 512, 3000, rand, ["rgba(255,255,255,.25)", "rgba(0,0,0,.2)"], 1.2);
  return { map: tex(c, { repeat: [15, 12], aniso: 8 }), roughnessMap: tex(rc, { repeat: [15, 12], srgb: false, aniso: 8 }) };
}

/** Kraft cardboard with fluting, a tape strip and handling marks. */
export function cardboard() {
  const W = 512, H = 512, rand = rng(21);
  const [c, g] = canvas(W, H);
  g.fillStyle = "#b48a5a"; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 3) { g.fillStyle = `rgba(90,60,30,${0.03 + rand() * 0.04})`; g.fillRect(0, y, W, 1); }
  speckle(g, W, H, 4000, rand, ["rgba(80,50,20,.25)", "rgba(220,180,130,.25)"], 1.3);
  for (let i = 0; i < 12; i++) {
    const x = rand() * W, y = rand() * H, r = 20 + rand() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(70,45,20,.18)"); grd.addColorStop(1, "rgba(70,45,20,0)");
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // brown packing tape across the top centre (u = .44–.56)
  g.fillStyle = "rgba(150,105,55,.75)"; g.fillRect(W * 0.44, 0, W * 0.12, H);
  g.fillStyle = "rgba(255,240,210,.18)"; g.fillRect(W * 0.45, 0, W * 0.02, H);
  // edge crush
  g.strokeStyle = "rgba(60,40,20,.35)"; g.lineWidth = 6; g.strokeRect(0, 0, W, H);
  return tex(c);
}

/** Powder-coated upright with the punched slot pattern racking has. */
export function upright(color = "#1f4e8c") {
  const W = 64, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(10,14,22,.85)";
  for (let y = 8; y < H; y += 24) { g.fillRect(W * 0.32, y, W * 0.12, 12); g.fillRect(W * 0.56, y, W * 0.12, 12); }
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, "rgba(0,0,0,.25)"); grd.addColorStop(0.5, "rgba(255,255,255,.08)"); grd.addColorStop(1, "rgba(0,0,0,.25)");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  return tex(c, { repeat: [1, 6] });
}

/** Galvanised wire mesh deck (alpha cut-out). */
export function wireDeck() {
  const S = 256;
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = "#d9dde2"; g.lineWidth = 5;
  for (let k = 0; k <= S; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.stroke(); }
  g.lineWidth = 3;
  for (let k = 0; k <= S; k += 64) { g.beginPath(); g.moveTo(0, k); g.lineTo(S, k); g.stroke(); }
  return tex(c, { repeat: [6, 2] });
}

/** Corrugated cladding for the walls. */
export function cladding() {
  const W = 256, H = 256, rand = rng(3);
  const [c, g] = canvas(W, H);
  for (let x = 0; x < W; x++) {
    const v = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 16);
    const l = 150 + v * 40;
    g.fillStyle = `rgb(${l - 6},${l},${l + 8})`; g.fillRect(x, 0, 1, H);
  }
  speckle(g, W, H, 600, rand, ["rgba(0,0,0,.08)", "rgba(255,255,255,.06)"], 1.5);
  return tex(c, { repeat: [10, 2] });
}

/** Pegboard for the Lab A bench. */
export function pegboard() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = "#c9a878"; g.fillRect(0, 0, S, S);
  g.fillStyle = "#3a2d1d";
  for (let y = 8; y < S; y += 16) for (let x = 8; x < S; x += 16) { g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); }
  return tex(c, { repeat: [3, 1.5] });
}

/** Floor decals: lane lines, bay letters, the entrance mark. One texture, one draw. */
export function floorDecals(layout) {
  const { W, D, px } = layout;   // metres and pixels-per-metre
  const [c, g] = canvas(W * px, D * px);
  const X = (x) => (x + W / 2) * px, Z = (z) => (z + D / 2) * px;
  g.clearRect(0, 0, c.width, c.height);
  g.filter = `blur(${0.18 * px}px)`;
  g.fillStyle = "rgba(0,0,0,.55)";
  for (const r of layout.racks) g.fillRect(X(r.x0 - 0.05), Z(r.z - 0.52), (r.x1 - r.x0 + 0.1) * px, 1.04 * px);
  for (const [x, z] of layout.pallets || []) g.fillRect(X(x - 0.62), Z(z - 0.52), 1.24 * px, 1.04 * px);
  g.filter = "none";
  g.strokeStyle = "rgba(232,184,38,.92)"; g.lineWidth = 0.1 * px; g.setLineDash([]);
  for (const r of layout.racks) {
    g.strokeRect(X(r.x0 - 0.15), Z(r.z - 0.65), (r.x1 - r.x0 + 0.3) * px, 1.3 * px);
  }
  // walkway
  g.strokeStyle = "rgba(240,240,236,.85)"; g.lineWidth = 0.08 * px; g.setLineDash([0.6 * px, 0.4 * px]);
  g.beginPath(); g.moveTo(X(-11.2), Z(layout.walkZ - 0.7)); g.lineTo(X(11), Z(layout.walkZ - 0.7)); g.moveTo(X(-11.2), Z(layout.walkZ + 0.7)); g.lineTo(X(11), Z(layout.walkZ + 0.7)); g.stroke();
  g.setLineDash([]);
  // aisle letters
  g.fillStyle = "rgba(240,240,236,.9)"; g.font = `700 ${1.1 * px}px "DM Sans", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  for (const r of layout.racks) g.fillText(r.name, X(r.x1 + 1.1), Z(r.z));
  // entrance
  g.fillStyle = "rgba(214,77,122,.9)";
  g.beginPath(); g.arc(X(layout.entrance.x), Z(layout.entrance.z), 0.45 * px, 0, 7); g.fill();
  g.fillStyle = "rgba(255,255,255,.95)"; g.font = `700 ${0.32 * px}px "DM Sans", system-ui, sans-serif`;
  g.fillText("IN", X(layout.entrance.x), Z(layout.entrance.z));
  // hatched no-stand zone in front of the roller door
  g.save(); g.beginPath(); g.rect(X(-11), Z(6.2), 3 * px, 1.6 * px); g.clip();
  g.strokeStyle = "rgba(232,184,38,.7)"; g.lineWidth = 0.12 * px;
  for (let k = -20; k < 40; k++) { g.beginPath(); g.moveTo(X(-11) + k * 0.4 * px, Z(6.2)); g.lineTo(X(-11) + k * 0.4 * px + 1.6 * px, Z(7.8)); g.stroke(); }
  g.restore();
  const t = tex(c, { aniso: 8 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Label atlas: every bin's printed label lives in one canvas, so all 72 labels
 * render in a single instanced draw. Cells are redrawn when stock changes.
 */
export class LabelAtlas {
  constructor(cells, cellPx = 128) {
    this.N = Math.ceil(Math.sqrt(cells));
    this.cell = cellPx;
    [this.canvas, this.g] = canvas(this.N * cellPx, (this.N * cellPx) / 2);
    this.texture = tex(this.canvas, { aniso: 8 });
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }
  // a label is 2:1, so cells are cell × cell/2
  cellRect(i) { const col = i % this.N, row = Math.floor(i / this.N); return [col * this.cell, row * this.cell / 2, this.cell, this.cell / 2]; }
  /** uv offset for the shader, flipY-corrected */
  cellUV(i) { const col = i % this.N, row = Math.floor(i / this.N); return [col, this.N - 1 - row]; }
  draw(i, { code, line, qty, tone = "ok" }) {
    const g = this.g, [x, y, w, h] = this.cellRect(i);
    g.fillStyle = "#f4f1ea"; g.fillRect(x, y, w, h);
    g.fillStyle = tone === "low" ? "#e8a21a" : tone === "bad" ? "#d23a2f" : tone === "empty" ? "#9a958c" : "#1c1c1e";
    g.fillRect(x, y, w, h * 0.34);
    g.fillStyle = "#fff"; g.font = `700 ${h * 0.24}px "JetBrains Mono", ui-monospace, monospace`; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillText(code, x + w * 0.06, y + h * 0.18);
    g.fillStyle = "#1c1c1e"; g.font = `600 ${h * 0.2}px "DM Sans", system-ui, sans-serif`;
    g.fillText(line.length > 13 ? line.slice(0, 12) + "…" : line, x + w * 0.06, y + h * 0.55);
    g.font = `500 ${h * 0.17}px "JetBrains Mono", ui-monospace, monospace`; g.fillStyle = "#555";
    g.fillText(qty, x + w * 0.06, y + h * 0.82);
    // tiny QR-ish block so it reads as a scannable label from a distance
    g.fillStyle = "#1c1c1e";
    const q = h * 0.42, qx = x + w - q - w * 0.05, qy = y + h * 0.46;
    const r = rng(i + 99);
    for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) if (r() > 0.5 || (a < 2 && b < 2) || (a > 4 && b < 2) || (a < 2 && b > 4)) g.fillRect(qx + (a * q) / 7, qy + (b * q) / 7, q / 7 + 0.4, q / 7 + 0.4);
    this.texture.needsUpdate = true;
  }
}

/** Mown grass: tonal patches + blade speckle, tiles seamlessly enough at 4 m. */
export function grass() {
  const S = 512, rand = rng(41);
  const [c, g] = canvas(S);
  g.fillStyle = "#4f6b34"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = rand() * S, y = rand() * S, r = 20 + rand() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand() < 0.5 ? "rgba(92,122,58," : "rgba(58,82,38,";
    grd.addColorStop(0, tone + (0.25 + rand() * 0.25) + ")"); grd.addColorStop(1, tone + "0)");
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = ["rgba(120,150,70,.35)", "rgba(40,60,28,.35)", "rgba(150,160,90,.2)"][(rand() * 3) | 0];
    g.fillRect(rand() * S, rand() * S, 1, 2 + rand() * 2);
  }
  return tex(c, { repeat: [1, 1], aniso: 8 });
}

/** Brick: running bond, mortar, per-brick tone variation. */
export function brick() {
  const W = 512, H = 512, rand = rng(17), bw = 64, bh = 24;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#cfc6ba"; g.fillRect(0, 0, W, H);
  for (let row = 0; row * bh < H; row++) for (let col = -1; col * bw < W; col++) {
    const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
    const t = 0.82 + rand() * 0.3;
    g.fillStyle = `rgb(${(178 * t) | 0},${(112 * t) | 0},${(86 * t) | 0})`;
    g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
  }
  speckle(g, W, H, 3000, rand, ["rgba(0,0,0,.12)", "rgba(255,255,255,.08)"], 1.2);
  return tex(c);
}

/** Smooth painted render with faint trowel variation. */
export function render() {
  const S = 256, rand = rng(5);
  const [c, g] = canvas(S);
  g.fillStyle = "#e9e5dc"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) { const x = rand() * S, y = rand() * S, r = 20 + rand() * 60; const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, `rgba(0,0,0,${0.02 + rand() * 0.03})`); grd.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2); }
  speckle(g, S, S, 1500, rand, ["rgba(0,0,0,.05)", "rgba(255,255,255,.08)"], 1);
  return tex(c);
}

/**
 * The site plan painted onto one texture: asphalt street with a centre line,
 * paved walks, the gate plaza and parking bays. Built from site.js values.
 */
export function siteDecals(site, paths, parking) {
  const { x0, x1, z0, z1 } = site.ground, px = 12;
  const W = Math.round((x1 - x0) * px), H = Math.round((z1 - z0) * px);
  const [c, g] = canvas(W, H);
  const X = (x) => (x - x0) * px, Z = (z) => (z - z0) * px;
  const rand = rng(77);
  g.clearRect(0, 0, W, H);
  const stroke = (pts, width, style) => { g.strokeStyle = style; g.lineWidth = width * px; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); };
  // kerb edge then surface, so every walk gets a light kerb line
  for (const p of paths) stroke(p, p === paths[1] ? 7.6 : 3.4, "rgba(196,190,178,.95)");
  stroke(paths[1], 7, "#3c3d40");
  for (const p of paths) if (p !== paths[1]) stroke(p, 3, "#a8a196");
  // street centre line
  g.setLineDash([2.5 * px, 2 * px]); stroke(paths[1], 0.14, "rgba(236,232,220,.85)"); g.setLineDash([]);
  // gate plaza
  g.fillStyle = "#b3ab9e"; g.beginPath(); g.arc(X(site.gate.x), Z(site.gate.z - 2), 7 * px, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(120,112,100,.5)"; g.lineWidth = 2;
  for (let r = 2; r < 7; r += 1.2) { g.beginPath(); g.arc(X(site.gate.x), Z(site.gate.z - 2), r * px, 0, Math.PI * 2); g.stroke(); }
  // parking
  const P = parking;
  g.fillStyle = "#3a3b3e"; g.fillRect(X(P.x - P.w / 2), Z(P.z - P.d / 2), P.w * px, P.d * px);
  g.strokeStyle = "rgba(236,232,220,.85)"; g.lineWidth = 0.12 * px;
  for (let i = 0; i <= P.bays; i++) { const x = P.x - P.w / 2 + (i * P.w) / P.bays; g.beginPath(); g.moveTo(X(x), Z(P.z - P.d / 2)); g.lineTo(X(x), Z(P.z - P.d / 2 + 5)); g.stroke(); }
  // wear on every hard surface
  g.globalCompositeOperation = "source-atop";
  speckle(g, W, H, 26000, rand, ["rgba(0,0,0,.12)", "rgba(255,255,255,.06)"], 1.6);
  g.globalCompositeOperation = "source-over";
  const t = tex(c, { aniso: 8 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

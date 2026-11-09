import * as D from "./data.js";
import { store, fmt, ago, RuleError, KIT } from "./data.js";
import { PLACEHOLDER, TOWER } from "./site.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const ACCENTS = ["#ff5c95", "#7cb7ff", "#e6b44a", "#5fbf7f", "#c79bff", "#ff8a5c", "#59d0c8"];

const CHAPTERS = [
  { key: "campus", name: "Floor" },
  { key: "find", name: "Find" },
  { key: "ledger", name: "Ledger" },
  { key: "pay", name: "Expenses" },
  { key: "condition", name: "Condition" },
];

const ui = {
  chapter: "campus",
  inside: false,       // inside the block, on Verlet's floor
  dept: null,          // department zone entered
  sel: null,           // { type: bin|piece|person|location, id }
  focusLoc: null,
  activeItem: null,    // { item, loc }
  action: "take", qty: 1, reason: "", attribute: "", error: "",
  edit: false, editPiece: null, undo: [],
  ledgerKinds: new Set(), ledgerMine: false, showReversed: false, fresh: new Set(),
  pay: { amount: "", purpose: "", momo: "", receipt: null, error: "" },
};

// ---- stage ---------------------------------------------------------------------
let scene = null;
const noop = () => {};
const stub = new Proxy({ bins: [], binById: new Map(), buildings: [] }, { get: (t, k) => (k in t ? t[k] : k === "project" || k === "freeSpot" ? () => null : k === "validPlacement" ? () => true : noop) });
// software GL (SwiftShader, llvmpipe): the intro shows a still and the 3D starts on sign-in
function softwareGL() {
  try {
    const c = document.createElement("canvas"), gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return null;
    const d = gl.getExtension("WEBGL_debug_renderer_info");
    const name = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch { return null; }
}
let booting = null;
function ensureScene() {
  if (!booting) booting = boot().then(() => { $("#fallback").hidden = scene !== stub; syncScene(); buildTags(); refreshLabels(); });
  return booting;
}
async function boot() {
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return fallback();
  try {
    const { createScene } = await import("./scene.js");
    scene = createScene($("#stage"), {
      onPick, onHover: hoverTip, onFrame: placeOverlays,
      onPieceSelect: (id) => { ui.editPiece = id; render(); },
      onPieceMoved: (id, x, z) => guard(() => { pushUndo(); D.updatePiece(id, { x, z }); }),
      onPieceRejected: () => toast("It doesn't fit there — it needs clear floor inside the walls", true),
    });
    window.__stage = scene;
  } catch (e) { console.warn("WebGL scene failed, showing the still", e); fallback(); }
}
function fallback() {
  scene = stub;
  $("#stage").hidden = true; $("#fallback").hidden = false;
  $("#hint").textContent = "3D is off on this device — every action still works from the panel";
}
function syncScene() {
  const s = store.get();
  scene.setData({ departments: s.departments, pieces: s.pieces, people: s.people, me: s.me });
}

// ---- labels on the warehouse boxes follow the stock ------------------------------
function refreshLabels() {
  for (const b of scene.bins) {
    const rows = D.stockAt(b.id);
    scene.setBinVisible(b.id, rows.length > 0);
    if (!rows.length) continue;
    const it = D.item(rows[0].item_id);
    const qty = rows.reduce((a, s) => a + s.quantity, 0), cap = rows.reduce((a, s) => a + s.capacity, 0), dmg = rows.reduce((a, s) => a + s.damaged, 0);
    const health = cap ? (cap - dmg) / cap : 1;
    scene.setLabel(b.id, { line: rows.length > 1 ? `${it.name} +${rows.length - 1}` : it.name, qty: `${qty} on shelf`, tone: health < 0.8 ? "bad" : qty <= Math.max(3, cap * 0.2) ? "low" : "ok" });
  }
  if (ui.chapter === "condition") scene.setHeat(heatMap());
}
function heatMap() {
  const m = {};
  for (const b of scene.bins) { const h = D.health(b.id); if (h != null) m[b.id] = h; }
  for (const pc of store.get().pieces) if (pc.location) { const h = D.health(pc.location, true); if (h != null) m[pc.location] = h; }
  return m;
}

// ---- navigation -----------------------------------------------------------------------
function setChapterMeter() {
  const idx = CHAPTERS.findIndex((c) => c.key === ui.chapter);
  $("#chapterNo").textContent = String(idx + 1).padStart(2, "0");
  const d = ui.dept && D.dept(ui.dept);
  $("#chapterName").textContent = ui.chapter === "campus" ? (d ? `Floor › ${d.name}` : ui.inside ? "Floor" : "Building") : CHAPTERS[idx].name;
  $("#chapterFill").style.transform = `scaleX(${(idx + 1) / CHAPTERS.length})`;
  for (const b of $$(".chapters button")) b.dataset.ch === ui.chapter ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
}
function go(chapter, { camera = true } = {}) {
  if (ui.edit) exitEdit();
  ui.chapter = chapter;
  if (chapter !== "find") { ui.sel = null; scene.select(null); scene.clearRoute(); }
  scene.setHeat(chapter === "condition" ? heatMap() : null);
  if (camera) {
    ui.inside = true;
    if (chapter === "pay") { ui.dept = "soft"; scene.enter(D.dept("soft").building); }
    else if (chapter === "condition") { ui.dept = null; scene.floor(); }
    else if (chapter !== "find") ui.dept ? scene.enter(D.dept(ui.dept).building) : scene.floor();
  }
  setHash(); render();
}
function setHash() {
  let h = `#${ui.chapter}`;
  if (ui.chapter === "campus") h = ui.dept ? `#dept/${ui.dept}` : ui.inside ? "#floor" : "#outside";
  if (ui.chapter === "find" && ui.sel) h = `#find/${ui.sel.type}/${ui.sel.id}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}

let titleTimer = 0;
function enterDept(id, { fly = true, quiet = false } = {}) {
  const d = D.dept(id); if (!d) return;
  if (ui.edit) exitEdit();
  const changed = ui.dept !== id;
  ui.dept = id; ui.inside = true; ui.sel = null; scene.select(null); scene.clearRoute();
  scene.enter(d.building, fly);
  if (changed && !quiet) titleCard(d);
  ui.chapter = "campus";
  scene.setHeat(null);
  setHash(); render();
}
function toCampus() {   // back to the whole floor
  if (ui.edit) exitEdit();
  ui.dept = null; ui.inside = true; ui.sel = null; scene.select(null); scene.clearRoute(); scene.setHeat(null); scene.floor();
  ui.chapter = "campus"; setHash(); render();
}
function toOutside() {
  if (ui.edit) exitEdit();
  ui.dept = null; ui.inside = false; ui.sel = null; scene.select(null); scene.clearRoute(); scene.setHeat(null); scene.campus();
  ui.chapter = "campus"; setHash(); render();
}
// the department's name sweeps across as the roof comes off
function titleCard(d) {
  if (reduceMotion.matches) return;
  const el = $("#titleCard");
  el.innerHTML = `<span class="tc-kicker" style="color:${d.accent}">${esc(D.building(d.building)?.name || "")}</span><span class="tc-name">${esc(d.name)}</span>`;
  el.classList.remove("play"); void el.offsetWidth; el.classList.add("play");
  clearTimeout(titleTimer); titleTimer = setTimeout(() => el.classList.remove("play"), 2400);
}

// ---- selection ----------------------------------------------------------------------
function selectionLocation(sel) {
  if (!sel) return null;
  if (sel.type === "bin" || sel.type === "location") return sel.id;
  if (sel.type === "piece") return store.get().pieces.find((p) => p.id === sel.id)?.location || null;
  return null;
}
function open(sel, { route = false, itemId = null, fly = true } = {}) {
  if (!sel) return;
  ui.focusLoc = null;
  // a location without its own 3D object resolves to the box or furniture that holds it
  if (sel.type === "location") {
    if (scene.binById.get(sel.id)) sel = { type: "bin", id: sel.id };
    else { const pc = D.pieceOfLocation(sel.id); if (pc) { ui.focusLoc = sel.id; sel = { type: "piece", id: pc.id }; } else return toast("That location isn't on the map yet.", true); }
  }
  const deptId = sel.type === "bin" ? "stock" : sel.type === "piece" ? store.get().pieces.find((p) => p.id === sel.id)?.dept : sel.type === "person" ? D.person(sel.id)?.dept : null;
  if (deptId && deptId !== ui.dept) { ui.dept = deptId; ui.inside = true; scene.enter(D.dept(deptId).building, false); titleCard(D.dept(deptId)); }
  ui.sel = sel;
  const loc = selectionLocation(sel);
  const rows = loc ? D.stockUnder(ui.focusLoc || loc) : [];
  const first = (itemId && rows.find((r) => r.item_id === itemId)) || rows[0];
  ui.activeItem = first ? { item: first.item_id, loc: first.location_id } : null;
  ui.error = ""; ui.reason = ""; ui.qty = 1; ui.attribute = "";
  if (!allowed(ui.action)) ui.action = "take";
  scene.select(sel);
  const tag = sel.type === "bin" ? scene.binById.get(sel.id)?.code : sel.type === "piece" ? pieceTitle(store.get().pieces.find((p) => p.id === sel.id)) : D.personName(sel.id);
  $("#pinText").textContent = tag || "";
  if (route) {
    scene.showRoute(sel);
    scene.overRoute(sel);
    clearTimeout(open.t);
    open.t = setTimeout(() => scene.focus(sel), reduceMotion.matches ? 0 : 1800);
  } else { scene.clearRoute(); if (fly) scene.focus(sel); }
  if (ui.chapter !== "find" && loc) ui.chapter = "find";
  setHash(); render();
  $("#panelBody").scrollTop = 0;
}
function clearSelection() {
  ui.sel = null; ui.activeItem = null; ui.focusLoc = null; scene.select(null); scene.clearRoute();
  if (ui.chapter === "find" && ui.dept) ui.chapter = "campus";
  setHash(); render();
}
function onPick(hit) {
  if (!hit) { if (ui.sel && !ui.edit) clearSelection(); return; }
  if (ui.edit) {
    if (hit.type === "piece" && store.get().pieces.find((p) => p.id === hit.id)?.dept === ui.dept) { ui.editPiece = hit.id; scene.selectPiece(hit.id); render(); }
    return;
  }
  if (hit.type === "tower") return toCampus();
  if (hit.type === "building") {
    const d = store.get().departments.find((x) => x.building === hit.id);
    if (d && d.id !== ui.dept) enterDept(d.id);
    return;
  }
  open(hit);
}
const pieceTitle = (pc) => (pc?.location ? D.loc(pc.location)?.name : KIT[pc?.kind]?.label) || "";

// ---- permissions shorthand ----------------------------------------------------------
const me = () => store.me();
const allowed = (kind) => (kind === "repair" ? D.canManageInventory(me()) : !!me());

// ---- panel rendering ------------------------------------------------------------------
function render() {
  if (!me()) return;
  setChapterMeter();
  const body = $("#panelBody");
  let html;
  if (ui.edit) html = editPanel();
  else if (ui.chapter === "campus") html = ui.sel ? selectionPanel() : ui.dept ? deptPanel() : ui.inside ? campusPanel() : outsidePanel();
  else html = { find: findPanel, ledger: ledgerPanel, pay: payPanel, condition: conditionPanel }[ui.chapter]();
  body.innerHTML = html;
  bindPanel(body);
  tickNumbers(body);
  $("#bldgTags").classList.toggle("hide", !!ui.dept || ui.chapter !== "campus" || !!ui.sel);
  $("#bldgTags").classList.toggle("outside", !ui.inside);
}

function campusPanel() {
  const s = store.get(), m = me(), admin = D.canEditCampus(m);
  const deps = s.departments.map((d) => ({ d, st: D.deptStats(d), b: D.building(d.building) }));
  return `
    <p class="kicker">01 · Floor ${TOWER.verletFloor} · Verlet's part</p>
    <h2>Verlet Robotics</h2>
    <p>${deps.length} departments, ${s.people.length} people, ${fmt(deps.reduce((a, x) => a + x.st.units, 0))} units on shelves. Pick a zone to walk into it.</p>
    <p class="note"><b>Measured from the walk-through video.</b> Column grid, walls, glazing, shelving and zones are estimated from tile and column counts. ${PLACEHOLDER ? "The outside of the block is a stand-in." : ""} Fix anything off with Edit layout.</p>
    <ul class="dept-list">${deps.map(({ d, st, b }) => `
      <li><button class="dept-card" data-enter="${d.id}" style="--acc:${d.accent}">
        <span class="dc-top"><i></i><b>${esc(d.name)}</b>${d.id === m?.dept ? `<span class="tag hl">yours</span>` : ""}</span>
        <span class="dc-meta">${esc(b?.name || "")} · ${st.people} ${st.people === 1 ? "person" : "people"}${d.lead ? ` · lead ${esc(D.personName(d.lead))}` : ""}</span>
        <span class="dc-stats"><span><b>${fmt(st.units)}</b> units</span><span><b>${st.low}</b> low</span><span><b>${st.damaged}</b> damaged</span></span>
      </button></li>`).join("")}</ul>
    ${admin ? peopleAdmin() : `<p class="small">Departments and who belongs where are set by the admin.</p>`}`;
}
function outsidePanel() {
  const s = store.get();
  return `
    <p class="kicker">01 · Building</p>
    <h2>${esc(TOWER.name)}</h2>
    <p>Verlet Robotics has part of floor ${TOWER.verletFloor} of ${TOWER.floors} — the pink band on the facade. ${s.people.length} people, ${s.departments.length} departments.</p>
    ${PLACEHOLDER ? `<p class="note"><b>Stand-in exterior.</b> Only Verlet's floor is modelled from the video; the outside of the block is context.</p>` : ""}
    <div class="btn-row"><button class="btn primary" data-campus>Go up to Verlet</button></div>`;
}
function peopleAdmin() {
  const s = store.get();
  return `
    <h3>People &amp; departments</h3>
    <p class="small">Prototype · saved on this device. A lead can rearrange their department.</p>
    <ul class="rows">${s.people.map((p) => `<li class="assign">
      <span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${D.roleLabel(p.role)}</span></span>
      <select class="mini" data-assign="${p.id}" aria-label="Department for ${esc(p.name)}"><option value="">No department</option>${s.departments.map((d) => `<option value="${d.id}" ${p.dept === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
      <label class="lead-toggle"><input type="checkbox" data-lead="${p.id}" ${s.departments.some((d) => d.lead === p.id) ? "checked" : ""} ${p.dept ? "" : "disabled"} /> lead</label>
    </li>`).join("")}</ul>`;
}

function deptPanel() {
  const d = D.dept(ui.dept), m = me(), st = D.deptStats(d), b = D.building(d.building);
  const canEdit = D.canEditDept(m, d), admin = D.canEditCampus(m), myDesk = D.deskOf(m?.id);
  const people = D.peopleIn(d.id);
  const holders = store.get().pieces.filter((p) => p.dept === d.id && p.location);
  return `
    <p class="kicker" style="color:${d.accent}">Zone · ${esc(b?.name || "")}</p>
    ${canEdit ? `<label class="title-edit"><span class="sr">Department name</span><input id="deptName" value="${esc(d.name)}" maxlength="40" /></label>` : `<h2>${esc(d.name)}</h2>`}
    <p>${d.lead ? `Led by ${esc(D.personName(d.lead))}. ` : ""}${people.length ? `${people.length} ${people.length === 1 ? "person works" : "people work"} here.` : "Nobody is assigned here yet."}</p>
    ${admin ? `<div class="swatches" role="group" aria-label="Department colour">${ACCENTS.map((c) => `<button class="sw" data-accent="${c}" style="--c:${c}" aria-label="Colour ${c}" aria-pressed="${c === d.accent}"></button>`).join("")}</div>` : ""}
    <div class="stats">
      <div class="stat"><b data-to="${st.units}">${fmt(st.units)}</b><span>units on shelves</span></div>
      <div class="stat"><b data-to="${st.low}">${st.low}</b><span>running low</span></div>
    </div>
    <div class="btn-row">
      ${canEdit ? `<button class="btn primary" data-edit>Edit layout</button>` : myDesk && myDesk.dept === d.id ? `<button class="btn primary" data-edit>Move my desk</button>` : ""}
      <button class="btn" data-campus>Whole floor</button>
    </div>
    <h3>People</h3>
    ${people.length ? `<ul class="rows">${people.map((p) => { const desk = D.deskOf(p.id); return `<li><button class="rowbtn" data-person="${p.id}"><span class="av" style="--c:${avatarColor(p.id)}">${esc(initials(p.name))}</span><span class="grow"><span class="t">${esc(p.name)}${p.id === m?.id ? " (you)" : ""}</span><span class="s">${D.roleLabel(p.role)}${d.lead === p.id ? " · lead" : ""} · ${desk && desk.dept === d.id ? "own desk" : "no desk yet"}</span></span></button></li>`; }).join("")}</ul>` : `<div class="empty"><b>No one here yet.</b><span>The admin assigns people from the campus view.</span></div>`}
    <h3>Stock here</h3>
    ${d.type === "stockroom" ? `<p class="small">Racks A–C (sample shelving) and Main Store › Rack 1. Click any box on the racks.</p>` : ""}
    ${holders.length ? `<ul class="rows">${holders.map((pc) => { const rows = D.stockUnder(pc.location); return `<li><button class="rowbtn" data-open-piece="${pc.id}"><span class="grow"><span class="t">${esc(D.loc(pc.location)?.name)}</span><span class="s">${esc(D.path(pc.location))}</span></span><span class="num">${rows.length ? `${rows.reduce((a, r) => a + r.quantity, 0)} units` : "empty"}</span></button></li>`; }).join("")}</ul>` : `<div class="empty"><b>No stock locations here.</b><span>Shelving that holds stock appears once it's linked to a location.</span></div>`}`;
}

function selectionPanel() {
  const sel = ui.sel;
  if (sel.type === "person") return personPanel(sel.id);
  const loc = selectionLocation(sel);
  if (loc) return inspector(loc);
  const pc = store.get().pieces.find((p) => p.id === sel.id);
  if (!pc) return deptPanel();
  const d = D.dept(pc.dept), m = me();
  return `
    <p class="kicker" style="color:${d.accent}">${esc(d.name)}</p>
    <h2>${esc(KIT[pc.kind].label)}</h2>
    <p>${pc.owner ? `${esc(D.personName(pc.owner))}'s ${pc.kind === "workstation" ? "desk" : KIT[pc.kind].label.toLowerCase()}.` : pc.kind === "workstation" ? "A free desk." : "Part of this department's layout."}</p>
    <div class="btn-row">${D.canMovePiece(m, pc) ? `<button class="btn primary" data-edit>${D.canEditDept(m, d) ? "Edit layout" : "Move my desk"}</button>` : ""}<button class="btn" data-close>Close</button></div>`;
}
function personPanel(id) {
  const p = D.person(id), d = D.dept(p.dept), desk = D.deskOf(id), m = me();
  const held = store.get().stock.flatMap((s) => { const n = D.held(s.item_id, s.location_id, id); return n ? [{ s, n }] : []; });
  return `
    <p class="kicker" ${d ? `style="color:${d.accent}"` : ""}>${d ? esc(d.name) : "No department"}</p>
    <h2>${esc(p.name)}</h2>
    <p>${D.roleLabel(p.role)}${d?.lead === id ? ` · leads ${esc(d.name)}` : ""}${desk ? " · has a desk" : ""}.</p>
    <h3>Holding</h3>
    ${held.length ? `<ul class="rows">${held.map(({ s, n }) => `<li><button class="rowbtn" data-open-loc="${s.location_id}" data-item="${s.item_id}"><span class="grow"><span class="t">${esc(D.item(s.item_id).name)}</span><span class="s">${esc(D.path(s.location_id))}</span></span><span class="num">${n}</span></button></li>`).join("")}</ul>` : `<div class="empty"><b>Nothing checked out.</b></div>`}
    ${D.canEditCampus(m) ? `<h3>Department</h3><select class="mini wide" data-assign="${id}" aria-label="Department for ${esc(p.name)}"><option value="">No department</option>${store.get().departments.map((x) => `<option value="${x.id}" ${p.dept === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
    <div class="btn-row"><button class="btn small" data-route-here>Route from the lifts</button><button class="btn small" data-close>Close</button></div>`;
}

function inspector(locId) {
  const l = D.loc(ui.focusLoc || locId), m = me();
  const rows = D.stockUnder(l.id);
  const items = rows.map((s) => {
    const it = D.item(s.item_id);
    const heldN = s.capacity - s.quantity - s.damaged, mine = D.held(s.item_id, s.location_id, m.id);
    const active = ui.activeItem && ui.activeItem.item === s.item_id && ui.activeItem.loc === s.location_id;
    const elsewhere = D.stockOf(s.item_id).filter((x) => x.location_id !== s.location_id);
    const sub = s.location_id !== l.id ? D.path(s.location_id).split(" › ").slice(D.path(l.id).split(" › ").length).join(" › ") : "";
    return `
      <div class="card ${active ? "active" : ""}" data-pick-item="${s.item_id}" data-pick-loc="${s.location_id}">
        <div class="card-head"><b>${esc(it.type)} · ${esc(it.name)}</b><span class="tag">${it.sku}</span></div>
        <div class="spec">${esc(it.model)}${it.spec ? ` · ${esc(it.spec)}` : ""}${it.sample ? " · sample" : ""}${sub ? ` · <span class="where">${esc(sub)}</span>` : ""}</div>
        <div class="bar" role="img" aria-label="${s.quantity} on shelf, ${heldN} held, ${s.damaged} damaged, of ${s.capacity}"><i class="a" style="flex-grow:${s.quantity}"></i><i class="h" style="flex-grow:${heldN}"></i><i class="d" style="flex-grow:${s.damaged}"></i></div>
        <div class="legend"><span><i style="background:var(--ok)"></i>${s.quantity} shelf</span><span><i style="background:var(--held)"></i>${heldN} held</span><span><i style="background:var(--bad)"></i>${s.damaged} damaged</span><span>= ${s.capacity}</span>${mine ? `<span class="tag hl">you hold ${mine}</span>` : ""}</div>
        ${elsewhere.length ? `<div class="legend">Also in ${elsewhere.slice(0, 3).map((x) => `<button class="link" data-open-loc="${x.location_id}" data-item="${x.item_id}" data-route="1">${esc(D.loc(x.location_id).code || D.loc(x.location_id).name)}</button>`).join(", ")}</div>` : ""}
      </div>`;
  }).join("");
  const s = ui.activeItem && rows.find((r) => r.item_id === ui.activeItem.item && r.location_id === ui.activeItem.loc);
  const needsReason = ["damaged", "lost", "repair"].includes(ui.action);
  const form = s ? `
    <h3>Act on ${esc(D.item(s.item_id).name)}</h3>
    <div class="seg" role="group" aria-label="Action">${["take", "return", "damaged", "lost", "repair"].map((k) => `<button type="button" data-action="${k}" aria-pressed="${ui.action === k}" ${allowed(k) ? "" : `disabled title="Repair is for inventory managers"`}>${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
    <form class="act-form" novalidate>
      <div class="act">
        <div class="stepper"><button type="button" data-step="-1" aria-label="One fewer">−</button><input id="qty" type="number" min="1" inputmode="numeric" value="${ui.qty}" aria-label="Quantity" /><button type="button" data-step="1" aria-label="One more">+</button></div>
        <button class="btn primary" type="submit">${{ take: "Take from shelf", return: "Return to shelf", damaged: "Mark damaged", lost: "Mark lost", repair: "Repair" }[ui.action]}</button>
      </div>
      ${needsReason ? `<label class="field"><span>${ui.action === "repair" ? "Fault this repair clears" : `Why was it ${ui.action}?`} (required)</span><input id="reason" value="${esc(ui.reason)}" placeholder="${ui.action === "repair" ? "e.g. replaced bent pins" : "e.g. dropped during field demo"}" /></label>` : ""}
      ${D.canManageInventory(m) && (ui.action === "damaged" || ui.action === "lost") ? `<label class="field"><span>Attribute to</span><select id="attr"><option value="">Me (${esc(m.name)})</option>${store.get().people.filter((p) => p.id !== m.id).map((p) => { const n = D.held(s.item_id, s.location_id, p.id); return `<option value="${p.id}" ${ui.attribute === p.id ? "selected" : ""}>${esc(p.name)}${n ? ` — holds ${n}` : ""}</option>`; }).join("")}</select></label>` : ""}
      <div class="err" role="alert">${esc(ui.error)}</div>
    </form>` : "";
  const d = D.deptOfLocation(l.id);
  return `
    <p class="kicker" ${d ? `style="color:${d.accent}"` : ""}>${d ? esc(d.name) : "Location"} · ${esc(l.kind || "")} ${esc(l.code || "")}</p>
    <h2>${rows.length ? esc(D.item(rows[0].item_id).name) + (rows.length > 1 ? ` <em>+${rows.length - 1}</em>` : "") : esc(l.name)}</h2>
    <div class="crumbs">${esc(D.path(l.id))}${l.sample ? " · sample shelving" : ""}</div>
    ${rows.length ? items + form : `<div class="empty"><b>Nothing stocked here.</b><span>${l.label ? esc(l.label) + ". " : ""}An inventory manager can add stock to this location.</span></div>`}
    <div class="btn-row"><button class="btn small" data-route-here>Route from the lifts</button><button class="btn small" data-close>Close</button></div>`;
}

function findPanel() {
  if (ui.sel) return selectionPanel();
  const s = store.get();
  return `
    <p class="kicker">02 · Find</p>
    <h2>What are you looking for?</h2>
    <p>Items, people, departments or box codes. The floor draws the route from the lifts to the shelf, in whichever zone it is.</p>
    <div class="btn-row"><button class="btn primary" data-search>Search everything <kbd>/</kbd></button></div>
    <h3>Catalogue</h3>
    <ul class="rows">${[...s.items].sort((a, b) => a.sample - b.sample).map((it) => { const st = D.stockOf(it.id); const n = st.reduce((a, x) => a + x.quantity, 0); const where = [...new Set(st.map((x) => D.deptOfLocation(x.location_id)?.name).filter(Boolean))]; return `<li><button class="rowbtn" data-find="${it.id}" ${st.length ? "" : "disabled"}><span class="grow"><span class="t">${esc(it.type)} · ${esc(it.name)}${it.sample ? ' <span class="tag">sample</span>' : ""}</span><span class="s">${it.sku} · ${esc(where.join(", ") || "not stocked")}</span></span><span class="num">${n}</span></button></li>`; }).join("")}</ul>`;
}

function editPanel() {
  const d = D.dept(ui.dept), m = me(), full = D.canEditDept(m, d);
  const pc = ui.editPiece && store.get().pieces.find((p) => p.id === ui.editPiece);
  const canPc = pc && D.canMovePiece(m, pc);
  return `
    <p class="kicker" style="color:${d.accent}">Editing · ${esc(d.name)}</p>
    <h2>${full ? "Arrange the floor" : "Move your desk"}</h2>
    <p class="note"><b>Prototype · saved on this device.</b> Drag on the floor to move. Snaps to 25 cm and won't sit on walls, doorways, racks or other furniture.</p>
    ${full ? `<h3>Add</h3><div class="palette">${D.kitFor(d.type).map((k) => `<button class="pal" data-add="${k}">${kitIcon(k)}<span>${esc(KIT[k].label)}</span></button>`).join("")}</div>` : ""}
    <h3>Selected</h3>
    ${pc ? `<div class="card active"><div class="card-head"><b>${esc(pieceTitle(pc))}</b>${pc.owner ? `<span class="tag hl">${esc(D.personName(pc.owner))}</span>` : ""}</div>
      <div class="spec">${pc.x.toFixed(2)} m, ${pc.z.toFixed(2)} m · ${Math.round(((pc.rot * 180) / Math.PI % 360 + 360) % 360)}°${pc.location ? " · holds stock" : ""}</div>
      <div class="btn-row">
        ${canPc ? `<button class="btn small" data-rotate>Rotate 90° <kbd>R</kbd></button>` : ""}
        ${full ? `<button class="btn small" data-dup>Duplicate <kbd>D</kbd></button><button class="btn small" data-remove ${pc.location ? 'disabled title="Holds stock"' : ""}>Remove <kbd>Del</kbd></button>` : ""}
      </div>
      ${full && pc.kind === "workstation" ? `<label class="field"><span>Desk belongs to</span><select id="deskOwner"><option value="">Free desk</option>${D.peopleIn(d.id).map((p) => `<option value="${p.id}" ${pc.owner === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
    </div>` : `<p class="small">${full ? "Click a piece of furniture, or add one." : "Your desk is tinted — drag it where you want it."}</p>`}
    <div class="btn-row"><button class="btn primary" data-done>Done</button><button class="btn" data-undo ${ui.undo.length ? "" : "disabled"}>Undo</button></div>`;
}

function ledgerPanel() {
  const m = me(), s = store.get();
  let rows = [...s.movements].reverse();
  if (!ui.showReversed) rows = rows.filter((x) => !x.reversed && x.kind !== "undo");
  if (ui.ledgerKinds.size) rows = rows.filter((x) => ui.ledgerKinds.has(x.kind));
  if (ui.ledgerMine) rows = rows.filter((x) => x.person_id === m.id || x.actor_id === m.id);
  const summary = {};
  for (const x of rows) { const k = (summary[x.kind] ||= { n: 0, u: 0 }); k.n++; k.u += Math.abs(x.delta); }
  return `
    <p class="kicker">03 · Append-only movement ledger</p>
    <h2>Every unit, accounted for</h2>
    <p>Across every department. Nothing is edited in place: undo writes a reversal row, the way the API does.</p>
    <div class="chips" role="group" aria-label="Filter by activity">${["take", "return", "damaged", "lost", "repair", "finish", "initial"].map((k) => `<button class="chip" data-kind="${k}" aria-pressed="${ui.ledgerKinds.has(k)}">${k}</button>`).join("")}</div>
    <div class="chips" style="margin-top:8px"><button class="chip" data-mine aria-pressed="${ui.ledgerMine}">mine only</button><button class="chip" data-rev aria-pressed="${ui.showReversed}">show reversed</button></div>
    <div class="console" id="console" role="log" aria-label="Movement ledger">
      ${rows.length ? rows.slice(0, 150).map((x) => { const it = D.item(x.item_id), l = D.loc(x.location_id); const undoable = !x.reversed && !["initial", "undo", "finish"].includes(x.kind) && (x.actor_id === m.id || x.person_id === m.id || D.canManageInventory(m)); const when = Date.now() - x.at < 86400e3 ? new Date(x.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ago(x.at).replace(" ago", ""); return `<div class="ln ${ui.fresh.has(x.id) ? "fresh" : ""} ${x.reversed ? "rev" : ""}" title="${esc(new Date(x.at).toLocaleString("en-GB"))}"><span>${when}</span><span class="k ${x.kind}">${x.kind}</span><span class="what"><span class="t">${x.delta > 0 ? "+" : ""}${x.delta || ""} ${esc(it?.name)}</span><span class="who">${esc(l?.code || l?.name)} · ${esc(D.personName(x.person_id))}${x.actor_id && x.actor_id !== x.person_id ? ` (by ${esc(D.personName(x.actor_id))})` : ""}${x.note ? ` · ${esc(x.note)}` : ""}</span></span>${undoable ? `<button data-undo-row="${x.id}">undo</button>` : "<span></span>"}</div>`; }).join("") : `<div class="ln"><span></span><span></span><span>No rows match these filters.</span><span></span></div>`}
    </div>
    <h3>Summary</h3>
    <ul class="rows">${Object.entries(summary).map(([k, v]) => `<li><span class="grow"><span class="t">${k}</span></span><span class="num">${v.n} rows · ${fmt(v.u)} units</span></li>`).join("") || "<li>—</li>"}</ul>
    <div class="btn-row"><button class="btn" data-csv>Export CSV</button><button class="btn" data-print>Print</button></div>`;
}

function payPanel() {
  const m = me(), s = store.get(), b = s.budget, used = b.allocated - b.remaining, C = 2 * Math.PI * 50;
  const can = D.canUsePayments(m), approve = D.canApprove(m), lim = D.limitsFor(m.id);
  const list = approve ? s.payments : s.payments.filter((p) => p.user_id === m.id);
  const steps = ["requested", "approved", "disbursing", "successful"];
  const month = new Date(b.year, b.month - 1).toLocaleString("en", { month: "long" });
  return `
    <p class="kicker">04 · Corporate expenses · MTN MoMo (mock mode)</p>
    <h2>${month} budget</h2>
    <div class="budget">
      <svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${fmt(b.remaining)} of ${fmt(b.allocated)} RWF left"><circle class="bg" cx="60" cy="60" r="50" /><circle class="fg" cx="60" cy="60" r="50" stroke-dasharray="${C}" stroke-dashoffset="${C * (used / b.allocated)}" /><text x="60" y="60">${Math.round((b.remaining / b.allocated) * 100)}%</text><text class="sub" x="60" y="76">left</text></svg>
      <div>
        <div class="stat" style="margin-bottom:8px"><b data-to="${b.remaining}">${fmt(b.remaining)}</b><span>RWF left of ${fmt(b.allocated)}</span></div>
        ${lim.daily ? limitBar("Today (you)", lim.spentToday, lim.daily) : ""}${lim.monthly ? limitBar("This month (you)", lim.spentMonth, lim.monthly) : ""}
        <div class="limit">${lim.perTxn ? `Per transaction: up to ${fmt(lim.perTxn)} RWF` : "No personal limits set"}</div>
      </div>
    </div>
    ${can ? `<h3>New request</h3>
    <form class="pay-form" novalidate>
      <label class="field"><span>Amount (RWF)</span><input id="pAmount" inputmode="numeric" value="${esc(ui.pay.amount)}" placeholder="e.g. 24000" /></label>
      <label class="field"><span>What it is for</span><input id="pPurpose" value="${esc(ui.pay.purpose)}" placeholder="e.g. Velcro straps × 10" /></label>
      <label class="field"><span>MoMo recipient</span><input id="pMomo" inputmode="tel" value="${esc(ui.pay.momo)}" placeholder="0788 123 456" /></label>
      <label class="field"><span>Receipt photo (optional)</span><input id="pReceipt" type="file" accept="image/*" capture="environment" /></label>
      ${ui.pay.receipt ? `<img class="receipt-preview" src="${ui.pay.receipt}" alt="Receipt preview" />` : ""}
      <div class="err" role="alert">${esc(ui.pay.error)}</div>
      <div class="btn-row"><button class="btn primary" type="submit">Send request</button></div>
    </form>` : `<div class="empty"><b>No payment permission.</b><span>Ask the admin to turn on payments for your account.</span></div>`}
    <h3>${approve ? "All requests" : "Your requests"}</h3>
    <ul class="rows">${list.map((p) => { const reached = p.timeline.map((t) => t[0]); const done = p.status === "successful" && reached.length === 1; return `<li style="display:block"><div style="display:flex;gap:12px;align-items:baseline"><span class="grow"><span class="t">${esc(p.purpose)}</span><span class="s">${esc(D.personName(p.user_id))} · ${esc(p.momo)} · ${ago(p.at)}</span></span><span class="num">${fmt(p.amount)}</span></div>
      <div class="timeline" aria-label="Status: ${p.status}">${p.status === "rejected" ? `<span class="on"></span><span class="no"></span>` : steps.map((st) => `<span class="${done || reached.includes(st) ? (st === p.status && !done && st !== "successful" && st !== "requested" ? "live" : "on") : ""}"></span>`).join("")}</div>
      <div class="legend"><span class="tag ${p.status === "successful" ? "ok" : p.status === "rejected" ? "bad" : p.status === "pending" ? "warn" : "hl"}">${p.status}</span>${p.note ? `<span>${esc(p.note)}</span>` : ""}
      ${approve && p.status === "pending" ? `<button class="btn small primary" data-approve="${p.id}">Approve &amp; disburse</button><button class="btn small" data-reject="${p.id}">Reject</button>` : ""}</div></li>`; }).join("") || `<li><div class="empty"><b>No requests yet.</b></div></li>`}</ul>`;
}
const limitBar = (label, spent, cap) => `<div class="limit">${label}: ${fmt(spent)} / ${fmt(cap)}<div class="bar"><i style="flex-grow:${spent}"></i><i style="flex-grow:${Math.max(0, cap - spent)};background:transparent"></i></div></div>`;

function conditionPanel() {
  const s = store.get(), groups = {};
  for (const st of s.stock.filter((x) => x.capacity)) {
    const d = D.deptOfLocation(st.location_id), it = D.item(st.item_id);
    const g = ((groups[d?.name || "Unassigned"] ||= {})[it.category || it.type] ||= {});
    const row = (g[it.id] ||= { it, capacity: 0, damaged: 0, loc: st.location_id });
    row.capacity += st.capacity; row.damaged += st.damaged;
  }
  return `
    <p class="kicker">05 · Condition report</p>
    <h2>What still works</h2>
    <p>Derived from the ledger, not typed in. Boxes and shelving on the site are tinted by how much of their stock is operational.</p>
    <div class="legend"><span><i style="background:var(--ok)"></i>97%+</span><span><i style="background:var(--warn)"></i>80–96%</span><span><i style="background:var(--bad)"></i>under 80%</span><span><i style="background:#59595e"></i>empty</span></div>
    <table class="cond"><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Ok</th></tr></thead>
      <tbody>${Object.entries(groups).map(([room, cats]) => `<tr class="room"><td colspan="3">${esc(room)}</td></tr>` + Object.entries(cats).map(([cat, its]) => Object.values(its).sort((a, b) => b.damaged / b.capacity - a.damaged / a.capacity).map((r) => { const c = D.condition(r); return `<tr><td><button class="link" data-open-loc="${r.loc}" data-item="${r.it.id}">${esc(cat)} · ${esc(r.it.name)}</button><span class="advice">${c.word} — ${c.advice}</span></td><td class="n">${r.capacity}</td><td class="n"><span class="tag ${c.pct >= 97 ? "ok" : c.pct >= 80 ? "warn" : "bad"}">${c.pct}%</span></td></tr>`; }).join("")).join("")).join("")}</tbody>
    </table>`;
}

// ---- panel events ---------------------------------------------------------------------
function bindPanel(body) {
  body.onclick = (e) => {
    const t = e.target.closest("button, [data-pick-item]");
    if (!t || t.disabled) return;
    const ds = t.dataset;
    if (ds.enter) return enterDept(ds.enter);
    if ("campus" in ds) return toCampus();
    if ("search" in ds) return openSearch();
    if (ds.openLoc) return open({ type: "location", id: ds.openLoc }, { itemId: ds.item, route: !!ds.route });
    if (ds.openPiece) return open({ type: "piece", id: ds.openPiece });
    if (ds.person) return open({ type: "person", id: ds.person });
    if (ds.find) return findItem(ds.find);
    if ("close" in ds) return clearSelection();
    if ("routeHere" in ds) { scene.showRoute(ui.sel); scene.overRoute(ui.sel); clearTimeout(open.t); open.t = setTimeout(() => scene.focus(ui.sel), reduceMotion.matches ? 0 : 1800); return; }
    if (ds.action) { ui.action = ds.action; ui.error = ""; ui.attribute = ""; return render(); }
    if (ds.step) { ui.qty = Math.max(1, (Number($("#qty").value) || 1) + Number(ds.step)); $("#qty").value = ui.qty; return; }
    if (ds.pickItem && !e.target.closest("button")) { const nx = { item: ds.pickItem, loc: ds.pickLoc }; if (!ui.activeItem || ui.activeItem.item !== nx.item || ui.activeItem.loc !== nx.loc) { ui.activeItem = nx; ui.error = ""; render(); } return; }
    if (ds.kind) { ui.ledgerKinds.has(ds.kind) ? ui.ledgerKinds.delete(ds.kind) : ui.ledgerKinds.add(ds.kind); return render(); }
    if ("mine" in ds) { ui.ledgerMine = !ui.ledgerMine; return render(); }
    if ("rev" in ds) { ui.showReversed = !ui.showReversed; return render(); }
    if (ds.undoRow) return guard(() => { D.undo(Number(ds.undoRow)); toast("Reversed — a reversal row was added"); });
    if ("csv" in ds) return downloadCsv();
    if ("print" in ds) return window.print();
    if (ds.approve) return guard(() => { D.decide(ds.approve, true); toast("Approved — disbursing over MoMo (mock)"); });
    if (ds.reject) return guard(() => { D.decide(ds.reject, false); toast("Request rejected"); });
    if (ds.accent) return guard(() => D.updateDept(ui.dept, { accent: ds.accent }));
    if ("edit" in ds) return enterEdit();
    if ("done" in ds) return exitEdit();
    if ("undo" in ds) return undoLayout();
    if (ds.add) return addPiece(ds.add);
    if ("rotate" in ds) return rotatePiece();
    if ("dup" in ds) return duplicatePiece();
    if ("remove" in ds) return removePiece();
  };
  body.onchange = (e) => {
    const t = e.target;
    if (t.dataset.assign) return guard(() => { const lead = $(`[data-lead="${t.dataset.assign}"]`)?.checked; D.assignPerson(t.dataset.assign, t.value || null, !!lead && !!t.value); toast(t.value ? `${D.personName(t.dataset.assign)} → ${D.dept(t.value).name}` : `${D.personName(t.dataset.assign)} unassigned`); });
    if (t.dataset.lead) return guard(() => { const p = D.person(t.dataset.lead); D.assignPerson(p.id, p.dept, t.checked); toast(t.checked ? `${p.name} now leads ${D.dept(p.dept).name}` : `${p.name} is no longer a lead`); });
    if (t.id === "deskOwner") return guard(() => { pushUndo(); D.assignDesk(ui.editPiece, t.value || null); });
    if (t.id === "deptName") return guard(() => D.updateDept(ui.dept, { name: t.value.trim() }));
    if (t.id === "attr") ui.attribute = t.value;
  };
  const qty = $("#qty", body); if (qty) qty.oninput = () => { ui.qty = Number(qty.value) || 1; };
  const reason = $("#reason", body); if (reason) reason.oninput = () => { ui.reason = reason.value; };
  const act = $(".act-form", body); if (act) act.onsubmit = (e) => { e.preventDefault(); doAction(); };
  const dn = $("#deptName", body); if (dn) dn.onkeydown = (e) => { if (e.key === "Enter") dn.blur(); };
  const pf = $(".pay-form", body);
  if (pf) {
    for (const [id, key] of [["pAmount", "amount"], ["pPurpose", "purpose"], ["pMomo", "momo"]]) $(`#${id}`, body).oninput = (e) => { ui.pay[key] = e.target.value; };
    $("#pReceipt", body).onchange = (e) => {
      e.stopPropagation();
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { ui.pay.error = "Receipt photos are capped at 5 MB."; return render(); }
      const r = new FileReader(); r.onload = () => { ui.pay.receipt = r.result; render(); }; r.readAsDataURL(f);
    };
    pf.onsubmit = (e) => {
      e.preventDefault();
      try { const p = D.requestPayment({ amount: ui.pay.amount.replace(/[, ]/g, ""), purpose: ui.pay.purpose, momo: ui.pay.momo, receipt: ui.pay.receipt }); ui.pay = { amount: "", purpose: "", momo: "", receipt: null, error: "" }; toast(`Request sent for ${fmt(p.amount)} RWF`); }
      catch (err) { if (!(err instanceof RuleError)) throw err; ui.pay.error = err.message; render(); }
    };
  }
  if ($("#console", body) && ui.fresh.size) setTimeout(() => ui.fresh.clear(), 1700);
}
function guard(fn) { try { fn(); } catch (err) { if (!(err instanceof RuleError)) throw err; toast(err.message, true); render(); } }

function doAction() {
  const kind = ui.action, qty = Number($("#qty").value), a = ui.activeItem;
  try {
    D.move({ kind, itemId: a.item, locationId: a.loc, qty, reason: ui.reason, attributeTo: ui.attribute || null });
    const it = D.item(a.item), l = D.loc(a.loc), where = l.code || l.name;
    if (ui.sel?.type === "bin") { if (kind === "take") scene.drop(ui.sel.id, qty, "out"); if (kind === "return" || kind === "repair") scene.drop(ui.sel.id, qty, "in"); }
    toast({ take: `Took ${qty} × ${it.name} from ${where}`, return: `Returned ${qty} × ${it.name} to ${where}`, damaged: `${qty} × ${it.name} marked damaged`, lost: `${qty} × ${it.name} marked lost`, repair: `${qty} × ${it.name} back in service` }[kind]);
    ui.reason = ""; ui.error = ""; ui.qty = 1; ui.attribute = "";
    render();
  } catch (err) {
    if (!(err instanceof RuleError)) throw err;
    ui.error = err.message; render(); $("#reason")?.setAttribute("aria-invalid", "true");
  }
}
function findItem(itemId) {
  const st = D.stockOf(itemId).sort((a, b) => b.quantity - a.quantity);
  if (!st.length) return toast("That item has no stock anywhere yet.", true);
  ui.chapter = "find";
  open({ type: "location", id: st[0].location_id }, { itemId, route: true });
}
function downloadCsv() {
  const rows = [...store.get().movements].reverse();
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([D.ledgerCsv(rows)], { type: "text/csv" })), download: `ledger-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${rows.length} ledger rows`);
}

// ---- layout editing -------------------------------------------------------------------
function canMove(id) { const pc = store.get().pieces.find((p) => p.id === id); return !!pc && pc.dept === ui.dept && D.canMovePiece(me(), pc); }
function enterEdit() {
  const d = D.dept(ui.dept); if (!d) return;
  ui.edit = true; ui.undo = [];
  const mine = D.deskOf(me().id);
  ui.editPiece = ui.sel?.type === "piece" ? ui.sel.id : !D.canEditDept(me(), d) && mine?.dept === d.id ? mine.id : null;
  ui.sel = null; scene.select(null); scene.clearRoute();
  scene.setEdit({ deptId: d.id, canMove });
  scene.enter(d.building);
  if (ui.editPiece) scene.selectPiece(ui.editPiece);
  document.body.classList.add("editing");
  render();
}
function exitEdit() {
  ui.edit = false; ui.editPiece = null; ui.undo = [];
  scene.setEdit(null); scene.select(null);
  document.body.classList.remove("editing");
  render();
}
function pushUndo() { ui.undo.push(store.get().pieces.filter((p) => p.dept === ui.dept).map((p) => ({ ...p }))); if (ui.undo.length > 30) ui.undo.shift(); }
function undoLayout() {
  const snap = ui.undo.pop(); if (!snap) return;
  guard(() => {
    if (D.canEditDept(me(), D.dept(ui.dept))) D.restorePieces(ui.dept, snap);
    else for (const p of snap) if (p.owner === me().id) D.updatePiece(p.id, { x: p.x, z: p.z, rot: p.rot });
  });
  if (ui.editPiece) requestAnimationFrame(() => scene.selectPiece(ui.editPiece));
}
function addPiece(kind) {
  const spot = scene.freeSpot(ui.dept, kind);
  if (!spot) return toast("No free floor left for that here", true);
  guard(() => { pushUndo(); const pc = D.addPiece(ui.dept, kind, spot.x, spot.z, 0); ui.editPiece = pc.id; scene.dropIn(pc.id); scene.selectPiece(pc.id); render(); toast(`${KIT[kind].label} added`); });
}
function rotatePiece() {
  const pc = store.get().pieces.find((p) => p.id === ui.editPiece); if (!pc || !canMove(pc.id)) return;
  const next = { ...pc, rot: pc.rot + Math.PI / 2 };
  if (!scene.validPlacement(next)) return toast("No room to turn it here — move it first", true);
  guard(() => { pushUndo(); D.updatePiece(pc.id, { rot: next.rot }); scene.selectPiece(pc.id); });
}
function duplicatePiece() {
  const pc = store.get().pieces.find((p) => p.id === ui.editPiece); if (!pc) return;
  const k = KIT[pc.kind];
  const tries = [[k.w + 0.25, 0], [-(k.w + 0.25), 0], [0, k.d + 0.25], [0, -(k.d + 0.25)]];
  let at = tries.map(([dx, dz]) => ({ ...pc, id: "_probe", owner: undefined, location: undefined, x: pc.x + dx, z: pc.z + dz })).find((p) => scene.validPlacement(p));
  if (!at) { const s = scene.freeSpot(ui.dept, pc.kind); at = s && { ...pc, ...s }; }
  if (!at) return toast("No free floor left for another one", true);
  guard(() => { pushUndo(); const n = D.addPiece(ui.dept, pc.kind, at.x, at.z, pc.rot); ui.editPiece = n.id; scene.dropIn(n.id); scene.selectPiece(n.id); render(); });
}
function removePiece() {
  const pc = store.get().pieces.find((p) => p.id === ui.editPiece); if (!pc) return;
  if (pc.location) return toast("This one holds stock — move the stock before removing it.", true);
  pushUndo();
  scene.select(null);
  scene.shrinkOut(pc.id, () => guard(() => { D.removePiece(pc.id); ui.editPiece = null; render(); }));
}

// ---- overlays: building tags, selection pin, hover tip -----------------------------
const pin = $("#pin"), tip = $("#tip");
let mouse = [0, 0];
addEventListener("pointermove", (e) => { mouse = [e.clientX, e.clientY]; if (!tip.hidden) placeTip(); }, { passive: true });
function placeTip() { tip.style.transform = `translate(${Math.min(mouse[0] + 16, innerWidth - 270)}px, ${mouse[1] + 14}px)`; }
function hoverTip(hit) {
  if (!ui.dept) scene.peek(hit?.type === "building" ? hit.id : null);
  if (!hit || (ui.sel && hit.type === ui.sel.type && hit.id === ui.sel.id)) { tip.hidden = true; return; }
  let html = "";
  if (hit.type === "tower") return toCampus();
  if (hit.type === "tower") {
    html = `<b>Verlet Robotics</b>Floor ${TOWER.verletFloor} of ${TOWER.floors} · part of the floor<br><span class="dim">Click to go up</span>`;
  } else if (hit.type === "building") {
    const d = store.get().departments.find((x) => x.building === hit.id), b = D.building(hit.id);
    if (d && d.id === ui.dept) { tip.hidden = true; return; }
    html = d ? `<b style="color:${d.accent}">${esc(d.name)}</b>${esc(b.name)} · ${D.peopleIn(d.id).length} people · ${fmt(D.deptStats(d).units)} units<br><span class="dim">Click to open</span>` : `<b>${esc(b.name)}</b>`;
  } else if (hit.type === "bin") {
    const l = D.loc(hit.id), rows = D.stockAt(hit.id);
    html = `<b>${esc(l.code)}</b>${rows.map((s) => `${esc(D.item(s.item_id).name)} · ${s.quantity} on shelf`).join("<br>")}`;
  } else if (hit.type === "piece") {
    const pc = store.get().pieces.find((p) => p.id === hit.id); if (!pc) return;
    const rows = pc.location ? D.stockUnder(pc.location) : [];
    html = `<b>${esc(pieceTitle(pc))}</b>${pc.owner ? `${esc(D.personName(pc.owner))}'s desk` : rows.length ? `${rows.length} items · ${rows.reduce((a, r) => a + r.quantity, 0)} units` : esc(KIT[pc.kind].label)}${ui.edit && canMove(pc.id) ? "<br><span class=dim>Drag to move</span>" : ""}`;
  } else if (hit.type === "person") {
    const p = D.person(hit.id);
    html = `<b>${esc(p.name)}</b>${D.roleLabel(p.role)} · ${esc(D.dept(p.dept)?.name || "no department")}`;
  }
  tip.innerHTML = html; tip.hidden = false; placeTip();
}
function placeOverlays() {
  if (ui.sel && !ui.edit) {
    const p = scene.project(ui.sel);
    if (p) { pin.hidden = false; pin.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`; } else pin.hidden = true;
  } else pin.hidden = true;
  if (!ui.dept && ui.chapter === "campus") for (const el of $$("#bldgTags .bt")) {
    const p = scene.project(el.dataset.b === "tower" ? { type: "tower" } : { type: "building", id: el.dataset.b });
    if (p) { el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`; el.hidden = false; } else el.hidden = true;
  }
}
function buildTags() {
  $("#bldgTags").innerHTML = `<button class="bt bt-tower" data-b="tower" data-enter-tag="tower" style="--acc:#ff5c95" tabindex="-1"><i></i><b>Verlet Robotics</b><span>floor ${TOWER.verletFloor}</span></button>` + store.get().departments.map((d) => `<button class="bt" data-b="${d.building}" data-enter-tag="${d.id}" style="--acc:${d.accent}" tabindex="-1"><i></i><b>${esc(d.name)}</b><span>${D.peopleIn(d.id).length}</span></button>`).join("");
}
$("#bldgTags").addEventListener("click", (e) => { const b = e.target.closest("[data-enter-tag]"); if (!b) return; if (b.dataset.enterTag === "tower") toCampus(); else enterDept(b.dataset.enterTag); });

// ---- search -------------------------------------------------------------------------------
const dlg = $("#search"), q = $("#q"), results = $("#results");
let hits = [], cursor = 0;
function openSearch() { if (!me()) return; dlg.showModal(); q.value = ""; runSearch(); q.focus(); }
function runSearch() {
  const term = q.value.trim(), s = store.get(), lc = term.toLowerCase();
  const binHits = term.length >= 2 ? scene.bins.filter((b) => b.code.toLowerCase().startsWith(lc.replace(/\s+/g, "-"))).slice(0, 3).map((b) => ({ bin: b })) : [];
  const peopleHits = term.length >= 2 ? s.people.filter((p) => p.name.toLowerCase().includes(lc)).slice(0, 3).map((p) => ({ person: p })) : [];
  const deptHits = term.length >= 2 ? s.departments.filter((d) => d.name.toLowerCase().includes(lc)).map((d) => ({ dept: d })) : [];
  hits = term ? [...deptHits, ...peopleHits, ...D.search(term).slice(0, 8).map((it) => ({ it })), ...binHits] : s.items.filter((i) => !i.sample).slice(0, 6).map((it) => ({ it }));
  cursor = 0;
  const mark = (str) => { let out = esc(str); if (!term) return out; for (const t of term.split(/\s+/).filter(Boolean)) out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>"); return out; };
  results.innerHTML = hits.length ? hits.map((h, i) => {
    const sel = `role="option" data-i="${i}" aria-selected="${i === cursor}"`;
    if (h.dept) return `<li ${sel}><span class="r1">${mark(h.dept.name)}</span><span class="r2">${esc(D.building(h.dept.building)?.name)} · ${D.peopleIn(h.dept.id).length} people</span><span class="r3">department</span></li>`;
    if (h.person) return `<li ${sel}><span class="r1">${mark(h.person.name)}</span><span class="r2">${D.roleLabel(h.person.role)} · ${esc(D.dept(h.person.dept)?.name || "no department")}</span><span class="r3">person</span></li>`;
    if (h.bin) { const rows = D.stockAt(h.bin.id); return `<li ${sel}><span class="r1">Box ${mark(h.bin.code)}</span><span class="r2">${rows.length ? rows.map((r) => esc(D.item(r.item_id).name)).join(", ") : "Empty"}</span><span class="r3">box</span></li>`; }
    const st = D.stockOf(h.it.id), where = [...new Set(st.map((x) => D.deptOfLocation(x.location_id)?.name).filter(Boolean))];
    return `<li ${sel}><span class="r1">${mark(h.it.type)} · ${mark(h.it.name)}</span><span class="r2">${mark(h.it.sku)} · ${mark(h.it.model)}${h.it.spec ? ` · ${mark(h.it.spec)}` : ""}</span><span class="r3">${st.reduce((a, x) => a + x.quantity, 0)} on shelf<br>${esc(where.join(" · ") || "not stocked")}</span></li>`;
  }).join("") : `<li class="empty">Nothing matches “${esc(term)}”. Search covers items (type, name, model, SKU, spec), people, departments and box codes.</li>`;
}
function choose(i) {
  const h = hits[i]; if (!h) return;
  dlg.close();
  if (h.dept) return enterDept(h.dept.id);
  ui.chapter = "find";
  if (h.person) return open({ type: "person", id: h.person.id }, { route: true });
  if (h.bin) return open({ type: "bin", id: h.bin.id }, { route: true });
  findItem(h.it.id);
}
q.addEventListener("input", runSearch);
q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(1, hits.length);
    $$("li[role=option]", results).forEach((li, i) => li.setAttribute("aria-selected", i === cursor));
    $$("li[role=option]", results)[cursor]?.scrollIntoView({ block: "nearest" });
  }
  if (e.key === "Enter") { e.preventDefault(); const i = cursor; setTimeout(() => choose(i), 0); }
});
results.addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) choose(Number(li.dataset.i)); });
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
$("#searchOpen").onclick = openSearch;

addEventListener("keydown", (e) => {
  if (!me() || e.target.closest("input, textarea, select") || document.querySelector("dialog[open]")) return;
  if (ui.edit) {
    const full = D.canEditDept(me(), D.dept(ui.dept));
    if (e.key.toLowerCase() === "r") return rotatePiece();
    if (e.key.toLowerCase() === "d" && full) return duplicatePiece();
    if ((e.key === "Delete" || e.key === "Backspace") && full) return removePiece();
    if (e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); return undoLayout(); }
    if (e.key === "Escape") return exitEdit();
    return;
  }
  if (e.key === "/" || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); openSearch(); }
  else if (/^[1-5]$/.test(e.key)) go(CHAPTERS[Number(e.key) - 1].key);
  else if (e.key === "Escape") { if (ui.sel) clearSelection(); else if (ui.dept) toCampus(); else if (ui.inside) toOutside(); }
});

// ---- toasts + numbers ----------------------------------------------------------------
function toast(msg, bad = false) {
  const el = Object.assign(document.createElement("div"), { className: `toast${bad ? " bad" : ""}`, textContent: msg });
  $("#toasts").append(el); setTimeout(() => el.remove(), 2800);
}
const lastNums = new Map();
function tickNumbers(root) {
  for (const el of $$("[data-to]", root)) {
    const key = el.nextElementSibling?.textContent || "", to = Number(el.dataset.to), from = lastNums.has(key) ? lastNums.get(key) : to;
    lastNums.set(key, to);
    if (from === to || reduceMotion.matches) continue;
    const t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
const avatarColor = (id) => ACCENTS[store.get().people.findIndex((p) => p.id === id) % ACCENTS.length];
function kitIcon(kind) {
  const P = { workstation: "M3 14h18M5 14v5M19 14v5M8 10h6v4H8z", bench: "M2 12h20M4 12v7M20 12v7M4 5h16v7", printer: "M5 4h14v16H5zM8 14h8", shelf: "M5 3v18M19 3v18M5 8h14M5 13h14M5 18h14", heavyRack: "M3 3v18M21 3v18M12 3v18M3 9h18M3 15h18", robotCell: "M6 20h12M9 20v-6l4-5 3 3M13 9l-2-3", amr: "M4 10h16v6H4zM7 19h.01M17 19h.01", server: "M6 3h12v18H6zM9 7h6M9 11h6M9 15h6", meeting: "M3 12h18M7 12v6M17 12v6M5 8h2M11 8h2M17 8h2", sofa: "M4 11v6h16v-6M6 11V8h12v3M4 17v2M20 17v2", board: "M3 5h18v10H3zM8 21l4-6 4 6", plant: "M12 21v-7M12 14c-4 0-6-3-6-7 4 0 6 3 6 7zM12 14c4 0 6-3 6-7-4 0-6 3-6 7z", frontDesk: "M3 10h18v9H3zM3 10l2-4h14l2 4", cases: "M4 8h16v11H4zM9 8V5h6v3", pallet: "M3 15h18M5 15v3M12 15v3M19 15v3M5 7h14v8H5z" };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P[kind] || "M4 4h16v16H4z"}"/></svg>`;
}

// ---- sign in ------------------------------------------------------------------------------
function buildSignIn() {
  const s = store.get();
  $("#roles").innerHTML = s.people.map((p) => {
    const d = D.dept(p.dept);
    return `<button class="role-card" data-person-in="${p.id}"><span class="rc" style="--acc:${d?.accent || "#888"}"><b>${esc(p.name)}</b><span>${D.roleLabel(p.role)} · ${esc(d?.name || "No department")}${d?.lead === p.id ? " · lead" : ""}</span></span></button>`;
  }).join("");
  for (const card of $$(".role-card")) {
    card.onclick = () => signIn(card.dataset.personIn);
    card.onpointermove = (e) => {
      if (reduceMotion.matches || e.pointerType !== "mouse") return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
      card.style.setProperty("--rx", `${-((e.clientY - r.top) / r.height - 0.5) * 8}deg`);
    };
    card.onpointerleave = () => { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); };
  }
}
async function signIn(id) {
  if (!booting) { $("#intro").classList.add("gone"); await ensureScene(); }
  store.signIn(id);
  const p = me();
  $("#roleLabel").textContent = p.name.split(" ")[0];
  $("#intro").classList.add("gone");
  document.body.classList.remove("pre");
  scene.intro(false);
  syncScene(); buildTags();
  const h = location.hash.slice(1).split("/");
  if (h[0] === "dept" && D.dept(h[1])) return enterDept(h[1]);
  if (h[0] === "find" && h[1] && h[2]) { ui.chapter = "find"; return open({ type: h[1], id: h.slice(2).join("/") }); }
  if (["ledger", "pay", "condition"].includes(h[0])) return go(h[0]);
  if (h[0] === "floor") return toCampus();
  if (h[0] === "outside") return toOutside();
  // home: the floors above lift, then you land in your own zone
  toCampus();
  if (p.dept) { clearTimeout(signIn.t); signIn.t = setTimeout(() => { if (!ui.dept && !ui.sel) enterDept(p.dept); }, reduceMotion.matches ? 0 : 2300); }
}
$("#roleChip").onclick = () => {
  if (ui.edit) exitEdit();
  buildSignIn();
  document.body.classList.add("pre");
  $("#intro").classList.remove("gone");
  ui.dept = null; ui.inside = false; ui.sel = null; scene.select(null); scene.clearRoute(); scene.campus(false); scene.intro(true);
  history.replaceState(null, "", "#outside");
  $(".role-card")?.focus();
};
$("#resetData").onclick = () => { if (ui.edit) exitEdit(); store.reset(); ui.sel = null; scene.select(null); scene.clearRoute(); toast("Mock data reset to the app's fixtures"); };
$("#aboutOpen").onclick = () => $("#about").showModal();
for (const b of $$(".chapters button")) b.onclick = () => (b.dataset.ch === "campus" ? toCampus() : go(b.dataset.ch));

// phone bottom sheet: drag the handle between three heights (FLIP, transform only)
(() => {
  const handle = $("#sheetHandle"), panel = $("#panel"), snaps = [0.3, 0.5, 0.8];
  let start = null;
  handle.addEventListener("pointerdown", (e) => { start = { y: e.clientY, h: panel.getBoundingClientRect().height }; handle.setPointerCapture(e.pointerId); panel.classList.remove("settle"); });
  handle.addEventListener("pointermove", (e) => { if (start) panel.style.setProperty("--sheet-h", `${Math.max(120, start.h + (start.y - e.clientY))}px`); });
  handle.addEventListener("pointerup", (e) => {
    if (!start) return;
    const h = (start.h + (start.y - e.clientY)) / innerHeight, moved = Math.abs(start.y - e.clientY) > 4;
    const cur = snaps.reduce((a, s) => (Math.abs(s - start.h / innerHeight) < Math.abs(a - start.h / innerHeight) ? s : a));
    const next = moved ? snaps.reduce((a, s) => (Math.abs(s - h) < Math.abs(a - h) ? s : a)) : snaps[(snaps.indexOf(cur) + 1) % snaps.length];
    const before = panel.getBoundingClientRect().height;
    panel.style.setProperty("--sheet-h", `${next * 100}vh`);
    const after = panel.getBoundingClientRect().height;
    panel.style.transform = `translateY(${after - before}px)`;
    requestAnimationFrame(() => { panel.classList.add("settle"); panel.style.transform = ""; });
    start = null;
  });
})();

function clock() { $("#clock").textContent = `Kigali ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" })}`; }
clock(); setInterval(clock, 15000);

// ---- store → view ------------------------------------------------------------------------
store.on((evt) => {
  if (evt.type === "move") ui.fresh.add(evt.row.id);
  if (["layout", "dept", "people", "reset", "me"].includes(evt.type)) { syncScene(); buildTags(); }
  if (evt.type === "move" || evt.type === "reset") refreshLabels();
  if (evt.type !== "me") render();
});
addEventListener("hashchange", () => {
  if (!me()) return;
  const h = location.hash.slice(1).split("/");
  if (h[0] === "dept" && D.dept(h[1]) && h[1] !== ui.dept) enterDept(h[1]);
  else if (h[0] === "floor" && (ui.dept || !ui.inside || ui.chapter !== "campus")) toCampus();
  else if (h[0] === "outside" && ui.inside) toOutside();
  else if (["ledger", "pay", "condition", "find"].includes(h[0]) && h.length === 1 && h[0] !== ui.chapter) go(h[0]);
});

// ---- start ----------------------------------------------------------------------------------
scene = stub;
document.body.classList.add("pre");
buildSignIn();
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const soft = softwareGL();
if (soft && !me()) {
  // a still of the building behind the intro; the 3D boots when someone signs in
  $("#fallback").hidden = false;
} else {
  await ensureScene();
  if (me()) signIn(me().id);
  else { scene.assemble(); scene.intro(true); }
}

// The campus: every building from site.js, the stockroom racks inside the
// warehouse, each department's furniture, and the people at their desks.
//
// Budget (Intel UHD laptop): one shadow-casting sun refitted to whatever is in
// view, instancing for every repeated thing (~50 draw calls for the whole
// site), pixel ratio capped, and frames drawn only when something moves.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as T from "./textures.js";
import { kitGeometry, avatarGeometry, shirtGeometry, KINDS } from "./kit.js";
import { RACKS, BAYS, LEVELS, SIDES, KIT } from "./data.js";
import { SITE, BUILDINGS, PATHS, TREES, PARKING } from "./site.js";

const BAY_W = 2.4, DEPTH = 1.0, LEVEL_Y = [0.14, 1.06, 1.98, 2.9], RACK_H = 3.75;
const X0 = -3.2;
const RACK_Z = { A: -5.6, B: -2.3, C: 1.0 };
const WALL_T = 0.25, CUT_H = 0.85;
export const LAYOUT = {
  W: 24, D: 16, px: 64, walkZ: 4.7,
  entrance: { x: -10.2, z: 6.9 },
  pallets: [[8.0, -3.0], [9.6, -3.0]],
  racks: RACKS.map((r) => ({ name: r, z: RACK_Z[r], x0: X0, x1: X0 + BAY_W * BAYS })),
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function easeOutBounce(x) { const n1 = 7.5625, d1 = 2.75; if (x < 1 / d1) return n1 * x * x; if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75; if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375; return n1 * (x -= 2.625 / d1) * x + 0.984375; }
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// world-space UVs so one texture reads at true scale on any scaled instance
function worldUV(mat, mode, tile) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTile = { value: tile };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTile;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
      #ifdef USE_MAP
        #ifdef USE_INSTANCING
          vec4 wuv = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 wuv = modelMatrix * vec4(position, 1.0);
        #endif
        vec3 wn = normalize(mat3(modelMatrix) * normal);
        ${mode === "wall" ? "vMapUv = (abs(wn.x) > 0.5 ? vec2(wuv.z, wuv.y) : abs(wn.y) > 0.5 ? wuv.xz : vec2(wuv.x, wuv.y)) * uTile;" : "vMapUv = wuv.xz * uTile;"}
      #endif`);
  };
  mat.customProgramCacheKey = () => `wuv-${mode}-${tile}`;
  return mat;
}

export function createScene(canvas, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  // software GL (SwiftShader, llvmpipe) turns every frame into a long CPU task
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  const lowPower = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuName);
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color("#a48f80"), 130, 460);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  camera.position.set(30, 70, 80);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.075, minDistance: 2.2, maxDistance: 140, maxPolarAngle: Math.PI * 0.47, zoomSpeed: 0.8, rotateSpeed: 0.55 });
  controls.target.set(-2, 0, -6);
  const G = SITE.ground;
  controls.addEventListener("change", () => {
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, G.x0, G.x1); t.z = THREE.MathUtils.clamp(t.z, G.z0, G.z1); t.y = THREE.MathUtils.clamp(t.y, -2, 4);
  });

  // ---- sky: gradient dome with a sun glow, not affected by fog --------------
  const sunDir = new THREE.Vector3();
  { const az = THREE.MathUtils.degToRad(40), el = THREE.MathUtils.degToRad(32); sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize(); }
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir }, uTop: { value: new THREE.Color("#2a3a55") }, uHorizon: { value: new THREE.Color("#c9a68a") }, uGround: { value: new THREE.Color("#a48f80") } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec3 vDir; uniform vec3 uSun, uTop, uHorizon, uGround;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uGround, pow(-h, 0.4));
        float s = max(dot(normalize(vDir), uSun), 0.0); c += vec3(1.0, 0.75, 0.5) * (pow(s, 64.0) * 1.2 + pow(s, 6.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  // ---- lights: one low warm sun, refitted to the area in view ---------------
  const hemi = new THREE.HemisphereLight("#bccbe0", "#5b4a3a", 0.55);
  const sun = new THREE.DirectionalLight("#ffd2a1", 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(lowPower ? 1024 : 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);
  let needsRender = true;
  function fitShadow(cx, cz, radius) {
    sun.target.position.set(cx, 0, cz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, radius * 3 + 40);
    const sc = sun.shadow.camera;
    sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 1; sc.far = radius * 6 + 90;
    sc.updateProjectionMatrix();
    needsRender = true;
  }
  fitShadow(-2, -6, 58);

  // ---- materials -------------------------------------------------------------
  const conc = T.concrete();
  conc.map.repeat.set(6, 4); conc.roughnessMap.repeat.set(6, 4);
  const floorMat = new THREE.MeshStandardMaterial({ map: conc.map, roughnessMap: conc.roughnessMap, roughness: 0.82 });
  const slabTex = conc.map.clone(); slabTex.repeat.set(1, 1); slabTex.needsUpdate = true;
  const slabMat = worldUV(new THREE.MeshStandardMaterial({ map: slabTex, roughness: 0.8 }), "floor", 0.25);
  const grassMat = worldUV(new THREE.MeshStandardMaterial({ map: T.grass(), roughness: 0.95 }), "floor", 0.09);
  const uprightMat = new THREE.MeshStandardMaterial({ map: T.upright(), roughness: 0.45, metalness: 0.35 });
  const beamMat = new THREE.MeshStandardMaterial({ color: "#e0621d", roughness: 0.42, metalness: 0.3 });
  const deckMat = new THREE.MeshStandardMaterial({ map: T.wireDeck(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.9 });
  const cardMat = new THREE.MeshStandardMaterial({ map: T.cardboard(), roughness: 0.92 });
  const toteMat = new THREE.MeshStandardMaterial({ color: "#2a6db5", roughness: 0.55, side: THREE.DoubleSide });
  const wallTex = { cladding: T.cladding(), render: T.render(), brick: T.brick(), concrete: slabTex.clone() };
  for (const t of Object.values(wallTex)) { t.repeat.set(1, 1); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
  const WALL_MATS = {
    cladding: worldUV(new THREE.MeshStandardMaterial({ map: wallTex.cladding, roughness: 0.55, metalness: 0.45 }), "wall", 0.4),
    render: worldUV(new THREE.MeshStandardMaterial({ map: wallTex.render, roughness: 0.9 }), "wall", 0.25),
    brick: worldUV(new THREE.MeshStandardMaterial({ map: wallTex.brick, roughness: 0.85 }), "wall", 0.45),
    concrete: worldUV(new THREE.MeshStandardMaterial({ map: wallTex.concrete, roughness: 0.85 }), "wall", 0.18),
  };
  const glassMat = new THREE.MeshStandardMaterial({ color: "#3b5268", metalness: 0.7, roughness: 0.06, envMapIntensity: 1.8, emissive: "#a9bccc", emissiveIntensity: 0.32 });
  const roofMat = new THREE.MeshStandardMaterial({ color: "#4d4f53", roughness: 0.85, metalness: 0.1 });
  const metalMat = new THREE.MeshStandardMaterial({ color: "#b9bdc2", roughness: 0.45, metalness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0.2 });
  const kitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1), e3 = new THREE.Euler();
  const compose = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => { q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry); return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)); };
  const place = (mesh, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => mesh.setMatrixAt(i, compose(x, y, z, sx, sy, sz, ry));
  const shade = (o, cast = true) => { o.castShadow = cast; o.receiveShadow = true; return o; };
  const unit = new THREE.BoxGeometry(1, 1, 1);

  // ---- ground: grass + the painted site plan ----------------------------------
  const GW = G.x1 - G.x0, GD = G.z1 - G.z0, gcx = (G.x0 + G.x1) / 2, gcz = (G.z0 + G.z1) / 2;
  const ground = shade(new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), grassMat), false);
  ground.rotation.x = -Math.PI / 2; ground.position.set(gcx, -0.02, gcz);
  const sitePlan = shade(new THREE.Mesh(new THREE.PlaneGeometry(GW, GD), new THREE.MeshStandardMaterial({ map: T.siteDecals(SITE, PATHS, PARKING), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })), false);
  sitePlan.rotation.x = -Math.PI / 2; sitePlan.position.set(gcx, -0.005, gcz);
  scene.add(ground, sitePlan);

  // ---- buildings from site.js --------------------------------------------------
  const B = BUILDINGS.map((b, i) => ({ ...b, idx: i, H: b.floors.reduce((a, f) => a + f.h, 0), open: 0, vel: 0, target: 0, assemble: 1, assembleT: null }));
  const byB = new Map(B.map((b) => [b.id, b]));
  const wallParts = {};
  const glassParts = [], doorParts = [], roofParts = [], accentParts = [], slabParts = [], hvacParts = [];
  for (const b of B) {
    const { x, z, w, d, H } = b, hw = w / 2, hd = d / 2;
    const walls = (wallParts[b.walls] ||= []);
    const wall = (cx, cz, len, along, cut, y0 = 0, h = H) => walls.push({ b, cut, m: compose(cx, y0 + h / 2, cz, along === "x" ? len : WALL_T, h, along === "x" ? WALL_T : len) });
    const dx = x + (b.door?.at || 0), dw = b.door?.w || 2, dh = b.door?.h || 2.6;
    const l0 = x - hw, l1 = dx - dw / 2, r0 = dx + dw / 2, r1 = x + hw;
    wall((l0 + l1) / 2, z + hd, l1 - l0, "x", true);
    wall((r0 + r1) / 2, z + hd, r1 - r0, "x", true);
    wall(dx, z + hd, dw, "x", true, dh, H - dh);
    wall(x, z - hd, w + WALL_T, "x", false);
    wall(x - hw, z, d, "z", false);
    wall(x + hw, z, d, "z", true);
    if (b.door) (b.door.kind === "glass" ? glassParts : doorParts).push({ b, cut: true, m: compose(dx, dh / 2, z + hd, dw - 0.05, dh, WALL_T * 0.6) });
    const win = b.windows?.strip || b.windows?.band;
    if (win) for (const side of win.sides) {
      const len = side === "front" || side === "back" ? w : d;
      const n = Math.floor((len - 1.2) / win.every);
      for (let k = 0; k < n; k++) {
        const t = -((n - 1) * win.every) / 2 + k * win.every;
        if (side === "front" && Math.abs(x + t - dx) < dw / 2 + win.w / 2 + 0.2) continue;
        const pos = side === "front" ? [x + t, z + hd] : side === "back" ? [x + t, z - hd] : side === "east" ? [x + hw, z + t] : [x - hw, z + t];
        const alongX = side === "front" || side === "back";
        glassParts.push({ b, cut: side === "front" || side === "east", m: compose(pos[0], win.y + win.h / 2, pos[1], alongX ? win.w : WALL_T + 0.04, win.h, alongX ? WALL_T + 0.04 : win.w) });
      }
    }
    roofParts.push({ b, m: compose(x, H + 0.15, z, w + WALL_T, 0.3, d + WALL_T) });
    for (const [px, pz, pw, pd] of [[x, z + hd, w + 0.4, 0.2], [x, z - hd, w + 0.4, 0.2], [x - hw, z, 0.2, d], [x + hw, z, 0.2, d]]) accentParts.push({ b, m: compose(px, H + 0.45, pz, pw, 0.6, pd) });
    hvacParts.push({ b, m: compose(x + w * 0.22, H + 0.75, z - d * 0.15, 2.2, 0.9, 1.4) }, { b, m: compose(x - w * 0.25, H + 0.55, z + d * 0.1, 1.2, 0.5, 1.2) });
    slabParts.push({ b, m: b.id === "b-store" ? new THREE.Matrix4().makeScale(0, 0, 0) : compose(x, -0.04, z, w, 0.1, d) });
  }
  function instanced(geo, mat, parts, cast = true) {
    const mesh = shade(new THREE.InstancedMesh(geo, mat, Math.max(1, parts.length)), cast);
    parts.forEach((p, i) => { p.mesh = mesh; p.i = i; mesh.setMatrixAt(i, p.m); });
    mesh.count = parts.length;
    scene.add(mesh);
    return mesh;
  }
  const wallMeshes = Object.entries(wallParts).map(([key, parts]) => {
    const mesh = instanced(unit, WALL_MATS[key], parts);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(parts.length * 3), 3);
    parts.forEach((p, i) => mesh.setColorAt(i, new THREE.Color(p.b.tint)));
    mesh.userData.parts = parts;
    return mesh;
  });
  const glassMesh = instanced(unit, glassMat, glassParts, false);
  const doorMesh = instanced(unit, metalMat, doorParts);
  const roofMesh = instanced(unit, roofMat, roofParts);
  const hvacMesh = instanced(unit, metalMat, hvacParts);
  const accentMesh = instanced(unit, accentMat, accentParts);
  accentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(accentParts.length * 3).fill(1), 3);
  const slabMesh = instanced(unit, slabMat, slabParts, false);
  slabMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(slabParts.length * 3).fill(1), 3);
  const FLOOR_TINT = { cladding: "#d6d2cc", render: "#cfc4b4", brick: "#c9cbcf", concrete: "#bdb8b0" };
  // the shared concrete texture is dark; floors lift it (>1 is fine in linear space)
  slabParts.forEach((p, i) => slabMesh.setColorAt(i, new THREE.Color(p.b.id === "b-robotics" ? "#c9ccd0" : FLOOR_TINT[p.b.walls] || "#cccccc").multiplyScalar(p.b.id === "b-robotics" ? 1.5 : 1.7)));
  const allParts = [...Object.values(wallParts).flat(), ...roofParts, ...accentParts, ...glassParts, ...doorParts, ...slabParts];

  // ---- warehouse floor + decals (the detailed one) ------------------------------
  const whFloor = shade(new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.W, LAYOUT.D), floorMat), false);
  whFloor.rotation.x = -Math.PI / 2; whFloor.position.y = 0.006;
  const decals = shade(new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.W, LAYOUT.D), new THREE.MeshStandardMaterial({ map: T.floorDecals(LAYOUT), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })), false);
  decals.rotation.x = -Math.PI / 2; decals.position.y = 0.01;
  scene.add(whFloor, decals);

  // ---- racks (instanced) ---------------------------------------------------------
  const uprights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, RACK_H, 0.07), uprightMat, RACKS.length * (BAYS + 1) * 2);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(BAY_W - 0.09, 0.11, 0.05), beamMat, RACKS.length * BAYS * LEVELS * 2);
  const decks = new THREE.InstancedMesh(new THREE.PlaneGeometry(BAY_W - 0.1, DEPTH - 0.04), deckMat, RACKS.length * BAYS * LEVELS);
  const braces = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.03, DEPTH * 1.25), uprightMat, RACKS.length * (BAYS + 1) * 5);
  let iu = 0, ib = 0, idk = 0, ibr = 0;
  for (const r of LAYOUT.racks) {
    for (let k = 0; k <= BAYS; k++) {
      const x = r.x0 + k * BAY_W;
      place(uprights, iu++, x, RACK_H / 2, r.z + DEPTH / 2);
      place(uprights, iu++, x, RACK_H / 2, r.z - DEPTH / 2);
      for (let bb = 0; bb < 5; bb++) { q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), bb % 2 ? 0.62 : -0.62); braces.setMatrixAt(ibr++, m4.compose(v.set(x, 0.45 + bb * 0.68, r.z), q, sv.set(1, 1, 1))); }
    }
    for (let bb = 0; bb < BAYS; bb++) {
      const cx = r.x0 + (bb + 0.5) * BAY_W;
      for (let l = 0; l < LEVELS; l++) {
        place(beams, ib++, cx, LEVEL_Y[l], r.z + DEPTH / 2);
        place(beams, ib++, cx, LEVEL_Y[l], r.z - DEPTH / 2);
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        decks.setMatrixAt(idk++, m4.compose(v.set(cx, LEVEL_Y[l] + 0.06, r.z), q, sv.set(1, 1, 1)));
      }
    }
  }
  for (const mesh of [uprights, beams, braces, decks]) scene.add(shade(mesh));

  // ---- bins: cardboard or blue totes, one printed label each --------------------
  const bins = [];
  for (const r of LAYOUT.racks) for (let b = 1; b <= BAYS; b++) for (let l = 1; l <= LEVELS; l++) for (const sd of SIDES) {
    const i = bins.length, tote = hash(i) < 0.32;
    const h = tote ? 0.42 : 0.5 + hash(i + 7) * 0.26, w = tote ? 0.9 : 0.86 + hash(i + 3) * 0.12;
    const cx = r.x0 + (b - 0.5) * BAY_W + (sd === "L" ? -0.58 : 0.58) + (hash(i + 5) - 0.5) * 0.06;
    bins.push({ id: `bin-${r.name}-${b}-${l}-${sd}`, code: `${r.name}-${b}-${l}-${sd}`, rack: r.name, bay: b, level: l, side: sd, x: cx, y: LEVEL_Y[l - 1] + 0.07 + h / 2, z: r.z + (hash(i + 9) - 0.5) * 0.05, w, h, d: tote ? 0.6 : 0.72, kind: tote ? "tote" : "card", rot: (hash(i + 11) - 0.5) * 0.05 });
  }
  const cardBins = bins.filter((b) => b.kind === "card"), toteBins = bins.filter((b) => b.kind === "tote");
  const cardMesh = new THREE.InstancedMesh(unit, cardMat, cardBins.length);
  const toteMesh = new THREE.InstancedMesh(toteGeometry(), toteMat, toteBins.length);
  cardBins.forEach((b, i) => { b.mesh = cardMesh; b.instance = i; place(cardMesh, i, b.x, b.y, b.z, b.w, b.h, b.d, b.rot); });
  toteBins.forEach((b, i) => { b.mesh = toteMesh; b.instance = i; place(toteMesh, i, b.x, b.y - b.h / 2, b.z, b.w, b.h, b.d, b.rot); });
  for (const mesh of [cardMesh, toteMesh]) { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3).fill(1), 3); scene.add(shade(mesh)); }
  const binById = new Map(bins.map((b) => [b.id, b]));
  for (const b of bins) { b.base = new THREE.Matrix4(); b.mesh.getMatrixAt(b.instance, b.base); b.visible = true; }

  const atlas = new T.LabelAtlas(bins.length);
  const labelMat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 });
  const labelGeo = new THREE.PlaneGeometry(0.38, 0.19);
  const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(bins.length * 2), 2);
  labelGeo.setAttribute("aCell", cellAttr);
  labelMat.onBeforeCompile = (sh) => {
    sh.uniforms.uN = { value: atlas.N };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aCell;\nuniform float uN;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (uv + aCell) / uN;\n#endif");
  };
  const labels = new THREE.InstancedMesh(labelGeo, labelMat, bins.length);
  bins.forEach((b, i) => {
    const [cx, cy] = atlas.cellUV(i);
    cellAttr.setXY(i, cx, cy);
    const ly = b.kind === "tote" ? b.y - b.h * 0.1 : b.y - b.h * 0.18;
    place(labels, i, b.x + Math.sin(b.rot) * b.d / 2, ly, b.z + (b.d / 2) * Math.cos(b.rot) + 0.004, 1, 1, 1, b.rot);
    b.label = i; b.labelBase = new THREE.Matrix4(); labels.getMatrixAt(i, b.labelBase);
  });
  labels.receiveShadow = true;
  scene.add(labels);

  // warehouse high-bay lamps (hidden once the roof lifts) + their light pools
  const fx = [[-6, -2], [0, -4], [0, 0.5], [6, -4], [6, 0.5], [-6, 4.5], [0, 5], [7, 5]];
  const fixtures = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.42, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: "#2d2f33", roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }), fx.length);
  const lenses = new THREE.InstancedMesh(new THREE.CircleGeometry(0.36, 20), new THREE.MeshBasicMaterial({ color: "#fff6e6" }), fx.length);
  const cords = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 1.2), metalMat, fx.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.12, color: "#ffe9c7" }), fx.length);
  fx.forEach(([x, z], i) => {
    place(fixtures, i, x, 6.4, z); place(cords, i, x, 7.1, z);
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); lenses.setMatrixAt(i, m4.compose(v.set(x, 6.29, z), q, sv.set(1, 1, 1)));
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); pools.setMatrixAt(i, m4.compose(v.set(x, 0.015, z), q, sv.set(1, 1, 1)));
  });
  scene.add(fixtures, lenses, cords, pools);

  // ---- trees and parked cars: dressing ------------------------------------------
  const trunk = shade(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.22, 2.6, 8), new THREE.MeshStandardMaterial({ color: "#5a4636", roughness: 0.9 }), TREES.length));
  const crown = shade(new THREE.InstancedMesh(treeCrownGeometry(), kitMat, TREES.length));
  TREES.forEach(([x, z], i) => { const s = 0.8 + hash(i + 3) * 0.55; place(trunk, i, x, 1.3 * s, z, s, s, s); place(crown, i, x, 2.2 * s, z, s, s, s, hash(i) * 6); });
  scene.add(trunk, crown);
  const cars = shade(new THREE.InstancedMesh(carGeometry(), kitMat, 5));
  [0, 1, 3, 5, 6].forEach((bay, i) => { const x = PARKING.x - PARKING.w / 2 + (bay + 0.5) * (PARKING.w / PARKING.bays); place(cars, i, x, 0, PARKING.z - PARKING.d / 2 + 2.5, 1, 1, 1, (hash(i) - 0.5) * 0.06); });
  cars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(15), 3);
  ["#d7d7d4", "#2c3e57", "#8a1c1c", "#1d1f22", "#9aa3ad"].forEach((c, i) => cars.setColorAt(i, new THREE.Color(c)));
  scene.add(cars);

  // ---- furniture: one instanced mesh per kind, shared across the campus ----------
  const kitMeshes = {};
  for (const kind of KINDS) {
    const mesh = shade(new THREE.InstancedMesh(kitGeometry(kind), kitMat, 64));
    mesh.count = 0; mesh.visible = false;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3).fill(1), 3);
    mesh.userData.slots = [];
    kitMeshes[kind] = mesh;
    scene.add(mesh);
  }
  let pieces = [], people = [], myId = null, dragState = null, heat = null, outlinePiece = null;
  const pieceAnim = new Map(), deptOf = new Map(), pieceById = new Map(), accents = {};
  const tone = { ok: new THREE.Color(1, 1, 1), hover: new THREE.Color(1.35, 1.28, 1.3), good: new THREE.Color("#5fbf7f"), fair: new THREE.Color("#e6b44a"), poor: new THREE.Color("#e2574c"), empty: new THREE.Color(0.35, 0.35, 0.37) };
  const MINE = new THREE.Color(1.3, 1.1, 1.2), BAD = new THREE.Color(1.7, 0.5, 0.5);
  function pieceWorld(pc) {
    const b = byB.get(deptOf.get(pc.dept)?.building);
    if (!b) return null;
    const a = pieceAnim.get(pc.id);
    return { x: b.x + pc.x, z: b.z + pc.z, y: a ? a.lift : 0, rot: a ? a.rot : pc.rot, scale: a ? a.scale : 1, b };
  }
  function pieceTint(pc) {
    if (dragState?.id === pc.id && !dragState.valid) return BAD;
    if (heat && pc.location) { const h = heat[pc.location]; if (h != null) return h >= 0.97 ? tone.good : h >= 0.8 ? tone.fair : tone.poor; }
    if (hover?.type === "piece" && hover.id === pc.id) return tone.hover;
    if (pc.owner && pc.owner === myId) return MINE;
    return tone.ok;
  }
  const visibleIn = (b) => b.open > 0.02 || b.id === "b-store";
  const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
  function layoutPieces() {
    for (const mesh of Object.values(kitMeshes)) { mesh.count = 0; mesh.userData.slots = []; }
    for (const pc of pieces) {
      const mesh = kitMeshes[pc.kind]; if (!mesh) continue;
      const w = pieceWorld(pc); if (!w) continue;
      const i = mesh.count++;
      mesh.userData.slots[i] = pc.id;
      mesh.setMatrixAt(i, visibleIn(w.b) ? compose(w.x, w.y, w.z, w.scale, w.scale, w.scale, w.rot) : HIDDEN);
      mesh.setColorAt(i, pieceTint(pc));
    }
    for (const mesh of Object.values(kitMeshes)) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); }
    if (outlinePiece) placeOutline(outlinePiece);
    layoutAvatars();
    needsRender = true;
  }

  // ---- people: an avatar at each assigned desk -----------------------------------
  const avatarMesh = shade(new THREE.InstancedMesh(avatarGeometry(), kitMat, 32));
  const shirtMesh = shade(new THREE.InstancedMesh(shirtGeometry(), kitMat, 32));
  shirtMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3).fill(1), 3);
  avatarMesh.count = shirtMesh.count = 0; avatarMesh.userData.slots = []; shirtMesh.userData.slots = [];
  scene.add(avatarMesh, shirtMesh);
  const PALETTE = ["#ff5c95", "#7cb7ff", "#e6b44a", "#5fbf7f", "#c79bff", "#ff8a5c", "#59d0c8"];
  function avatarSpot(p) {
    const desk = pieces.find((pc) => pc.kind === "workstation" && pc.owner === p.id && pc.dept === p.dept);
    if (desk) { const w = pieceWorld(desk); if (!w) return null; const lx = -0.2, lz = 0.85; return { x: w.x + lx * Math.cos(w.rot) + lz * Math.sin(w.rot), z: w.z - lx * Math.sin(w.rot) + lz * Math.cos(w.rot), rot: w.rot + Math.PI, b: w.b }; }
    const d = deptOf.get(p.dept), b = d && byB.get(d.building); if (!b) return null;
    const k = people.filter((x) => x.dept === p.dept).indexOf(p);
    return { x: b.x + (b.door?.at || 0) + 1.4 + k * 0.7, z: b.z + b.d / 2 - 1.6, rot: Math.PI, b };
  }
  function layoutAvatars() {
    avatarMesh.count = shirtMesh.count = 0; avatarMesh.userData.slots = []; shirtMesh.userData.slots = [];
    people.forEach((p, k) => {
      const s = avatarSpot(p); if (!s) return;
      const i = avatarMesh.count++; shirtMesh.count++;
      avatarMesh.userData.slots[i] = shirtMesh.userData.slots[i] = p.id;
      const m = visibleIn(s.b) ? compose(s.x, 0, s.z, 1, 1, 1, s.rot) : HIDDEN;
      avatarMesh.setMatrixAt(i, m); shirtMesh.setMatrixAt(i, m);
      shirtMesh.setColorAt(i, new THREE.Color(PALETTE[k % PALETTE.length]).multiplyScalar(hover?.type === "person" && hover.id === p.id ? 1.35 : 0.9));
    });
    for (const mm of [avatarMesh, shirtMesh]) { mm.instanceMatrix.needsUpdate = true; mm.computeBoundingSphere(); }
    shirtMesh.instanceColor.needsUpdate = true;
  }

  // ---- overlays: selection, ring, route, edit grid ---------------------------------
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: "#ff5c95", transparent: true }));
  outline.visible = false; scene.add(outline);
  const ringMat = new THREE.MeshBasicMaterial({ color: "#ff5c95", transparent: true, opacity: 0.6, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 48), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false; scene.add(ring);
  const routeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uLen: { value: 1 }, uColor: { value: new THREE.Color("#ff5c95") } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec2 vUv; uniform float uTime, uReveal, uLen; uniform vec3 uColor;
      void main(){ if (vUv.x > uReveal) discard;
        float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        float chev = fract(vUv.x * 1.1 - uTime * 1.1 - abs(vUv.y - 0.5) * 0.9);
        float dash = smoothstep(0.0, 0.08, chev) * smoothstep(0.62, 0.5, chev);
        float head = smoothstep(uReveal - 1.2, uReveal, vUv.x);
        gl_FragColor = vec4(uColor, edge * (0.22 + dash * 0.7 + head * 0.3)); }`,
  });
  const route = new THREE.Mesh(new THREE.BufferGeometry(), routeMat);
  route.position.y = 0.035; route.visible = false; route.renderOrder = 2; scene.add(route);
  const gridMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSize: { value: new THREE.Vector2(10, 10) }, uT: { value: 0 } },
    vertexShader: "varying vec2 vP; uniform vec2 uSize; void main(){ vP = position.xy * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec2 vP; uniform vec2 uSize; uniform float uT;
      void main(){ vec2 g = abs(fract(vP / 0.5 - 0.5) - 0.5) / fwidth(vP / 0.5); float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 m = abs(fract(vP / 2.0 - 0.5) - 0.5) / fwidth(vP / 2.0); float major = 1.0 - min(min(m.x, m.y), 1.0);
        vec2 e = uSize * 0.5 - abs(vP); float edgeFade = smoothstep(0.0, 1.2, min(e.x, e.y));
        gl_FragColor = vec4(1.0, 0.36, 0.58, (line * 0.22 + major * 0.35) * edgeFade * uT); }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gridMat);
  grid.rotation.x = -Math.PI / 2; grid.position.y = 0.025; grid.visible = false; grid.renderOrder = 1; scene.add(grid);

  const unitMesh = shade(new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.1, 0.12), cardMat, 12));
  unitMesh.count = 0; scene.add(unitMesh);
  let units = [];

  // ---- colour state -------------------------------------------------------------
  let hover = null, selected = null, introOn = false;
  const binColor = (b) => {
    if (heat) { const h = heat[b.id]; if (h == null) return tone.empty; return h >= 0.97 ? tone.good : h >= 0.8 ? tone.fair : tone.poor; }
    if (hover?.type === "bin" && hover.id === b.id && selected?.id !== b.id) return tone.hover;
    return tone.ok;
  };
  function repaint() {
    for (const b of bins) b.mesh.setColorAt(b.instance, binColor(b));
    cardMesh.instanceColor.needsUpdate = toteMesh.instanceColor.needsUpdate = true;
    accentParts.forEach((p) => accentMesh.setColorAt(p.i, new THREE.Color(accents[p.b.id] || "#8a8a8a").multiplyScalar(hover?.type === "building" && hover.id === p.b.id ? 1.4 : 1)));
    accentMesh.instanceColor.needsUpdate = true;
    layoutPieces();
  }

  // ---- building animation: assemble, open (roof lifts, walls cut away) -------------
  let buildingsDirty = true;
  const S = new THREE.Matrix4(), M = new THREE.Matrix4(), R = new THREE.Matrix4(), Tm = new THREE.Matrix4(), Ti = new THREE.Matrix4();
  function updateBuildings(dt) {
    let moving = false;
    for (const b of B) {
      const k = 70, c = 2 * Math.sqrt(k) * 0.72;   // slightly under-damped: roofs land with a bounce
      b.vel += (k * (b.target - b.open) - c * b.vel) * dt; b.open += b.vel * dt;
      if (Math.abs(b.target - b.open) < 0.0005 && Math.abs(b.vel) < 0.0005) { b.open = b.target; b.vel = 0; } else moving = true;
      if (b.assembleT != null) { b.assembleT += dt; b.assemble = Math.min(1, Math.max(0, (b.assembleT - b.idx * 0.22) / 1.15)); if (b.assemble >= 1) b.assembleT = null; moving = true; }
    }
    if (!moving && !buildingsDirty) return false;
    buildingsDirty = false;
    const grow = (b) => (b.assemble >= 1 ? 1 : Math.max(0, easeOutBack(b.assemble)));
    for (const mesh of wallMeshes) for (const p of mesh.userData.parts) {
      const o = Math.min(1, Math.max(0, p.b.open));
      const f = (p.cut ? 1 - o * (1 - CUT_H / p.b.H) : 1) * grow(p.b);
      S.makeScale(1, Math.max(0.0001, f), 1); mesh.setMatrixAt(p.i, M.multiplyMatrices(S, p.m));
    }
    for (const [mesh, parts] of [[glassMesh, glassParts], [doorMesh, doorParts]]) for (const p of parts) {
      const o = Math.min(1, Math.max(0, p.b.open));
      const f = (p.cut ? 1 - smooth(0.05, 0.45, o) : 1) * grow(p.b);
      S.makeScale(1, Math.max(0.0001, f), 1); mesh.setMatrixAt(p.i, M.multiplyMatrices(S, p.m));
    }
    // the roof group lifts, tilts and spins away, then shrinks out; drops in on assemble
    for (const [mesh, parts] of [[roofMesh, roofParts], [hvacMesh, hvacParts], [accentMesh, accentParts]]) for (const p of parts) {
      const b = p.b, o = b.open;
      const drop = b.assemble >= 1 ? 0 : (1 - easeOutBounce(Math.max(0, b.assemble))) * 16;
      const shrink = Math.max(0.0001, (1 - smooth(0.55, 0.98, o)) * (b.assemble > 0 || b.assemble >= 1 ? 1 : 0.0001));
      Tm.makeTranslation(b.x, b.H + o * 18 + drop, b.z); Ti.makeTranslation(-b.x, -b.H, -b.z);
      e3.set(o * 0.42, o * 0.6, -o * 0.18); R.makeRotationFromEuler(e3);
      S.makeScale(shrink, shrink, shrink);
      mesh.setMatrixAt(p.i, M.copy(Tm).multiply(R).multiply(S).multiply(Ti).multiply(p.m));
    }
    for (const mesh of [...wallMeshes, glassMesh, doorMesh, roofMesh, hvacMesh, accentMesh]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
    const st = byB.get("b-store");
    fixtures.visible = lenses.visible = cords.visible = st.open < 0.08;
    layoutPieces();
    return true;
  }

  // ---- picking ------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function setRay(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function pick(clientX, clientY) {
    setRay(clientX, clientY);
    const targets = [cardMesh, toteMesh, avatarMesh, shirtMesh, ...Object.values(kitMeshes).filter((m) => m.visible), ...wallMeshes, roofMesh, accentMesh, glassMesh, doorMesh, slabMesh];
    for (const h of ray.intersectObjects(targets, false)) {
      const o = h.object;
      if (o === cardMesh || o === toteMesh) { const b = (o === cardMesh ? cardBins : toteBins)[h.instanceId]; if (b?.visible) return { type: "bin", id: b.id }; continue; }
      if (o === avatarMesh || o === shirtMesh) return { type: "person", id: o.userData.slots[h.instanceId] };
      if (o.userData.slots) return { type: "piece", id: o.userData.slots[h.instanceId] };
      const part = allParts.find((p) => p.mesh === o && p.i === h.instanceId);
      if (part) return { type: "building", id: part.b.id };
    }
    return null;
  }

  // ---- pointer: click to pick, drag furniture in edit mode ------------------------
  let down = null, edit = null, pendingMove = null, flight = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY };
    flight = null;
    if (!edit) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit?.type !== "piece" || !edit.canMove(hit.id)) return;
    const pc = pieceById.get(hit.id), w = pieceWorld(pc);
    setRay(e.clientX, e.clientY);
    const p = ray.ray.intersectPlane(groundPlane, new THREE.Vector3());
    dragState = { id: hit.id, ox: p ? w.x - p.x : 0, oz: p ? w.z - p.z : 0, start: { x: pc.x, z: pc.z }, valid: true, moved: false };
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    anim(hit.id).liftTo = 0.22;
    hooks.onPieceSelect?.(hit.id);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragState) {
      setRay(e.clientX, e.clientY);
      const p = ray.ray.intersectPlane(groundPlane, new THREE.Vector3()); if (!p) return;
      const pc = pieceById.get(dragState.id), b = byB.get(deptOf.get(pc.dept).building);
      const snap = (n) => Math.round(n * 4) / 4;
      const nx = snap(p.x + dragState.ox - b.x), nz = snap(p.z + dragState.oz - b.z);
      if (nx !== pc.x || nz !== pc.z) { pc.x = nx; pc.z = nz; dragState.valid = validPlacement(pc); dragState.moved = true; layoutPieces(); selectPiece(pc.id); }
      return;
    }
    if (e.pointerType === "mouse") pendingMove = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointerup", (e) => {
    if (dragState) {
      const pc = pieceById.get(dragState.id), d = dragState;
      dragState = null; controls.enabled = true;
      const a = anim(pc.id); a.liftTo = 0;
      if (!d.valid) { pc.x = d.start.x; pc.z = d.start.z; hooks.onPieceRejected?.(pc.id); }
      else if (d.moved) { a.lift = 0.22; a.vy = -1.5; a.drop = true; hooks.onPieceMoved?.(pc.id, pc.x, pc.z); }
      layoutPieces(); selectPiece(pc.id);
      down = null;
      return;
    }
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    hooks.onPick?.(pick(e.clientX, e.clientY));
  });
  canvas.addEventListener("pointerleave", () => { pendingMove = null; if (hover) { hover = null; repaint(); hooks.onHover?.(null); } });

  // ---- layout validation: inside the walls, door and racks kept clear, no overlaps
  function footprint(pc) {
    const k = KIT[pc.kind], quarter = Math.round((((pc.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 2;
    const w = quarter ? k.d : k.w, d = quarter ? k.w : k.d;
    return { x0: pc.x - w / 2, x1: pc.x + w / 2, z0: pc.z - d / 2, z1: pc.z + d / 2 };
  }
  const overlap = (a, b) => a.x0 < b.x1 - 0.02 && a.x1 > b.x0 + 0.02 && a.z0 < b.z1 - 0.02 && a.z1 > b.z0 + 0.02;
  function validPlacement(pc) {
    const d = deptOf.get(pc.dept), b = byB.get(d.building), f = footprint(pc);
    const hw = b.w / 2 - WALL_T / 2 - 0.15, hd = b.d / 2 - WALL_T / 2 - 0.15;
    if (f.x0 < -hw || f.x1 > hw || f.z0 < -hd || f.z1 > hd) return false;
    const door = { x0: (b.door?.at || 0) - (b.door?.w || 2) / 2 - 0.2, x1: (b.door?.at || 0) + (b.door?.w || 2) / 2 + 0.2, z0: b.d / 2 - 1.8, z1: b.d / 2 };
    if (overlap(f, door)) return false;
    if (b.id === "b-store") {
      for (const r of LAYOUT.racks) if (overlap(f, { x0: r.x0 - 0.6, x1: r.x1 + 0.6, z0: r.z - 0.6, z1: r.z + 1.6 })) return false;
      if (overlap(f, { x0: -11.8, x1: -4, z0: 3.6, z1: 8 })) return false;    // walkway from the roller door
    }
    return !pieces.some((o) => o.id !== pc.id && o.dept === pc.dept && overlap(f, footprint(o)));
  }
  function freeSpot(deptId, kind) {
    const d = deptOf.get(deptId), b = byB.get(d.building);
    const probe = { id: "_probe", dept: deptId, kind, x: 0, z: 0, rot: 0 };
    for (let r = 0; r < Math.max(b.w, b.d); r += 0.5) for (let a = 0; a < 24; a++) {
      probe.x = Math.round(Math.cos((a / 24) * Math.PI * 2) * r * 4) / 4; probe.z = Math.round(Math.sin((a / 24) * Math.PI * 2) * r * 4) / 4;
      if (validPlacement(probe)) return { x: probe.x, z: probe.z };
    }
    return null;
  }

  // ---- piece animation: drop in, lift while dragged, spring rotation, shrink out --
  function anim(id) {
    let a = pieceAnim.get(id);
    if (!a) { const pc = pieceById.get(id); a = { lift: 0, vy: 0, liftTo: 0, rot: pc?.rot || 0, scale: 1, scaleTo: 1 }; pieceAnim.set(id, a); }
    return a;
  }
  function updatePieces(dt) {
    let moving = false;
    for (const [id, a] of pieceAnim) {
      const pc = pieceById.get(id);
      if (a.drop) {
        a.vy -= 22 * dt; a.lift += a.vy * dt; moving = true;
        if (a.lift <= a.liftTo) { a.lift = a.liftTo; if (Math.abs(a.vy) > 1.4) a.vy = -a.vy * 0.32; else { a.vy = 0; a.drop = false; } }
      } else { const nl = damp(a.lift, a.liftTo, 14, dt); if (Math.abs(nl - a.lift) > 0.0005) moving = true; a.lift = Math.abs(nl - a.liftTo) < 0.0005 ? a.liftTo : nl; }
      if (pc) { if (Math.abs(pc.rot - a.rot) > 0.001) { a.rot = damp(a.rot, pc.rot, 11, dt); moving = true; } else a.rot = pc.rot; }
      const ns = damp(a.scale, a.scaleTo, 11, dt);
      if (Math.abs(ns - a.scaleTo) > 0.002) { a.scale = ns; moving = true; } else a.scale = a.scaleTo;
      if (a.scaleTo === 0 && a.scale === 0) { pieceAnim.delete(id); a.done?.(); continue; }
      if (!a.drop && a.liftTo === 0 && a.lift === 0 && a.scale === 1 && a.scaleTo === 1 && pc && a.rot === pc.rot) pieceAnim.delete(id);
    }
    if (moving) layoutPieces();
    return moving;
  }

  // ---- camera flights ---------------------------------------------------------------
  function flyTo(pos, target, ms = 1500, lift = null) {
    if (reduceMotion.matches) { camera.position.copy(pos); controls.target.copy(target); controls.update(); needsRender = true; return null; }
    const dist = camera.position.distanceTo(pos);
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), ms, lift: lift ?? (dist > 12 ? Math.min(16, dist * 0.22) : 0.3), ease: easeInOut };
    return flight;
  }
  const narrow = () => canvas.clientWidth < 700;
  const campusShot = () => (narrow() ? [new THREE.Vector3(18, 118, 96), new THREE.Vector3(-3, -6, 8)] : [new THREE.Vector3(46, 64, 82), new THREE.Vector3(10, 0, -5)]);
  function deptShot(buildingId) {
    const b = byB.get(buildingId);
    if (b.id === "b-store") return narrow() ? [new THREE.Vector3(7.5, 15, 19), new THREE.Vector3(0.6, -1.6, 2.6)] : [new THREE.Vector3(12.5, 10.5, 15.5), new THREE.Vector3(2.4, 0.6, -1.4)];
    const r = Math.max(b.w, b.d);
    if (narrow()) return [new THREE.Vector3(b.x + r * 0.35, r * 1.35, b.z + b.d / 2 + r * 1.0), new THREE.Vector3(b.x, -1.8, b.z + b.d * 0.25)];
    return [new THREE.Vector3(b.x + r * 0.6, r * 0.8, b.z + b.d / 2 + r * 0.7), new THREE.Vector3(b.x + b.w * 0.14, 0.4, b.z)];
  }
  function focusPoint(sel) {
    if (!sel) return null;
    if (sel.type === "bin") { const b = binById.get(sel.id); return b && new THREE.Vector3(b.x, b.y, b.z); }
    if (sel.type === "piece") { const pc = pieceById.get(sel.id); const w = pc && pieceWorld(pc); return w && new THREE.Vector3(w.x, 0.9, w.z); }
    if (sel.type === "person") { const p = people.find((x) => x.id === sel.id); const s = p && avatarSpot(p); return s && new THREE.Vector3(s.x, 1.1, s.z); }
    if (sel.type === "building") { const b = byB.get(sel.id); return b && new THREE.Vector3(b.x, b.H, b.z); }
    return null;
  }
  function focus(sel) {
    const p = focusPoint(sel); if (!p) return;
    if (sel.type === "bin") {
      const b = binById.get(sel.id), next = { A: "B", B: "C" }[b.rack];
      const camZ = next ? RACK_Z[next] - DEPTH / 2 - 0.12 : p.z + 3.6;
      flyTo(new THREE.Vector3(p.x + (narrow() ? 0.5 : 1.25), Math.max(1.4, p.y + 0.42), camZ), new THREE.Vector3(p.x + (narrow() ? 0.05 : 0.62), p.y - (narrow() ? 1.0 : 0.04), p.z));
      return;
    }
    const rot = sel.type === "piece" ? pieceWorld(pieceById.get(sel.id)).rot : sel.type === "person" ? avatarSpot(people.find((x) => x.id === sel.id)).rot + Math.PI : 0;
    const dist = narrow() ? 5.2 : 4.6;
    const off = new THREE.Vector3(Math.sin(rot) * dist + (narrow() ? 0 : 1.4), narrow() ? 4.6 : 3.2, Math.cos(rot) * dist + 0.8);
    flyTo(p.clone().add(off), p.clone().add(new THREE.Vector3(narrow() ? 0 : 1.0, narrow() ? -1.6 : -0.3, 0)));
  }
  function select(sel) {
    selected = sel; outlinePiece = null;
    const b = sel?.type === "bin" ? binById.get(sel.id) : null;
    if (b) { outline.visible = true; outline.position.set(b.x, b.y, b.z); outline.scale.set(b.w + 0.04, b.h + 0.04, b.d + 0.04); outline.rotation.y = b.rot; outline.material.color.set("#ff5c95"); }
    else if (sel?.type === "piece") selectPiece(sel.id);
    else outline.visible = false;
    repaint();
  }
  function selectPiece(id) { outlinePiece = pieceById.has(id) ? id : null; placeOutline(id); }
  function placeOutline(id) {
    const pc = pieceById.get(id); if (!pc) { outline.visible = false; outlinePiece = null; return; }
    const w = pieceWorld(pc), f = footprint(pc), h = kitMeshes[pc.kind].geometry.boundingBox.max.y;
    outline.visible = true;
    outline.position.set(w.x, w.y + (h + 0.04) / 2, w.z);
    outline.scale.set(f.x1 - f.x0 + 0.08, h + 0.08, f.z1 - f.z0 + 0.08);
    outline.rotation.y = 0;
    outline.material.color.set(dragState && !dragState.valid ? "#ff5a4f" : "#ff5c95");
    needsRender = true;
  }

  // ---- routes: gate → street → (site path) → door → inside -------------------------
  function approach(sel) {
    if (sel.type === "bin") { const b = binById.get(sel.id), az = RACK_Z[b.rack] + DEPTH / 2 + 1.15; return { b: byB.get("b-store"), start: [LAYOUT.entrance.x, LAYOUT.entrance.z], inside: [[X0 - 1.1, LAYOUT.walkZ], [X0 - 1.1, az], [b.x, az]] }; }
    let spot = null;
    if (sel.type === "piece") { const pc = pieceById.get(sel.id), w = pc && pieceWorld(pc); if (w) { const dd = KIT[pc.kind].d / 2 + 0.8; spot = { x: w.x + Math.sin(w.rot) * dd, z: w.z + Math.cos(w.rot) * dd, b: w.b }; } }
    if (sel.type === "person") { const p = people.find((x) => x.id === sel.id); spot = p && avatarSpot(p); }
    if (!spot) return null;
    const b = spot.b, dx = b.x + (b.door?.at || 0), din = b.z + b.d / 2 - 1.0;
    return { b, start: [dx, din], inside: [[dx, spot.z], [spot.x, spot.z]] };
  }
  function showRoute(sel) {
    const a = approach(sel); if (!a) { clearRoute(); return 0; }
    const b = a.b, dx = b.x + (b.door?.at || 0), dz = b.z + b.d / 2;
    let pts = [[SITE.gate.x, SITE.gate.z], [SITE.gate.x, SITE.street.z]];
    const spur = PATHS.find((p) => p[0][1] === SITE.street.z && Math.abs(p[p.length - 1][0] - dx) < 0.6 && p !== PATHS[1]);
    if (spur) pts.push(...spur); else pts.push([dx, SITE.street.z], [dx, dz + 0.6]);
    pts.push([dx, dz - 0.3], a.start, ...a.inside);
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.05);
    const geo = ribbon(chaikin(pts, 3), 0.5);
    route.geometry.dispose(); route.geometry = geo;
    routeMat.uniforms.uLen.value = geo.userData.length;
    routeMat.uniforms.uReveal.value = reduceMotion.matches ? geo.userData.length : 0;
    route.visible = true;
    const end = pts[pts.length - 1]; ring.position.set(end[0], 0.03, end[1]); ring.visible = true;
    needsRender = true;
    return geo.userData.length;
  }
  function clearRoute() { route.visible = false; ring.visible = false; needsRender = true; }
  function overRoute(sel) {
    const end = focusPoint(sel); if (!end) return;
    const sx = SITE.gate.x, sz = SITE.gate.z, cx = (end.x + sx) / 2, cz = (end.z + sz) / 2, span = Math.hypot(end.x - sx, end.z - sz);
    flyTo(new THREE.Vector3(cx + span * 0.3, 10 + span * (narrow() ? 1.3 : 0.8), cz + span * (narrow() ? 0.9 : 0.55)), new THREE.Vector3(cx, narrow() ? -span * 0.12 : 0, cz + (narrow() ? span * 0.2 : -2)), 1500);
  }

  function drop(id, n, dir) {
    const b = binById.get(id); const p = b ? new THREE.Vector3(b.x, b.y, b.z) : null; if (!p) return;
    n = Math.min(n, 8);
    for (let i = 0; i < n; i++) {
      if (dir === "out") units.push({ p: new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.1, p.z + b.d / 2), v: new THREE.Vector3(Math.random() - 0.5, 1.4 + Math.random() * 0.8, 0.8 + Math.random() * 0.6), r: new THREE.Euler(), w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), age: -i * 0.07, life: 2.2, mode: "out" });
      else units.push({ p: new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.3, p.y + 1.6 + i * 0.15, p.z + 0.05), v: new THREE.Vector3(0, -0.5, 0), r: new THREE.Euler(), w: new THREE.Vector3(Math.random() * 3, Math.random() * 3, 0), age: -i * 0.09, life: 3, mode: "in", floor: b.y + b.h / 2 - 0.08 });
    }
    needsRender = true;
  }
  function setBinVisible(id, on) {
    const b = binById.get(id); if (!b || b.visible === on) return;
    b.visible = on;
    b.mesh.setMatrixAt(b.instance, on ? b.base : HIDDEN); b.mesh.instanceMatrix.needsUpdate = true; b.mesh.computeBoundingSphere();
    labels.setMatrixAt(b.label, on ? b.labelBase : HIDDEN); labels.instanceMatrix.needsUpdate = true;
    needsRender = true;
  }
  function setLabel(id, data) { const b = binById.get(id); if (b) { atlas.draw(b.label, { code: b.code, ...data }); needsRender = true; } }
  function project(sel) {
    const p = focusPoint(sel); if (!p) return null;
    if (sel.type === "bin") p.y += binById.get(sel.id).h / 2 + 0.18;
    else if (sel.type === "piece") p.y += 1.1 + (pieceAnim.get(sel.id)?.lift || 0);
    else if (sel.type === "person") p.y += 0.6;
    else if (sel.type === "building") p.y += 1.5 + byB.get(sel.id).open * 18;
    p.project(camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * canvas.clientHeight };
  }

  // ---- loop ---------------------------------------------------------------------------
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = w < 700 ? 54 : 42; camera.updateProjectionMatrix();
    needsRender = true;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let last = performance.now(), running = true, raf = 0, t = 0;
  const dummy = new THREE.Object3D();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    let dirty = needsRender; needsRender = false;
    if (introOn && !flight && !reduceMotion.matches && !lowPower) {
      const off = camera.position.clone().sub(controls.target);
      off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, dt * 0.03);
      camera.position.copy(controls.target).add(off); dirty = true;
    }
    if (flight) {
      dirty = true;
      const k = Math.min(1, (now - flight.start) / flight.ms), e = flight.ease(k);
      camera.position.lerpVectors(flight.p0, flight.p1, e);
      camera.position.y += Math.sin(Math.PI * e) * flight.lift;
      controls.target.lerpVectors(flight.t0, flight.t1, e);
      if (k >= 1) { flight = null; hooks.onArrive?.(); }
    }
    if (controls.update()) dirty = true;
    sky.position.copy(camera.position);
    if (updateBuildings(dt)) dirty = true;
    if (updatePieces(dt)) dirty = true;
    if (pendingMove && !dragState) {
      const hit = pick(...pendingMove); pendingMove = null;
      const key = hit ? `${hit.type}:${hit.id}` : "", was = hover ? `${hover.type}:${hover.id}` : "";
      if (key !== was) {
        hover = hit; repaint(); dirty = true; hooks.onHover?.(hit);
        canvas.style.cursor = hit ? (edit && hit.type === "piece" && edit.canMove(hit.id) ? "move" : "pointer") : "grab";
      }
    }
    if (route.visible || outline.visible || ring.visible || units.length || (grid.visible && gridMat.uniforms.uT.value < 0.999)) dirty = true;
    routeMat.uniforms.uTime.value = t;
    if (route.visible) routeMat.uniforms.uReveal.value = damp(routeMat.uniforms.uReveal.value, routeMat.uniforms.uLen.value + 1, 1.4, dt);
    if (outline.visible) outline.material.opacity = 0.65 + Math.sin(t * 4) * 0.3;
    if (ring.visible) { const k = (t * 0.8) % 1; ring.scale.setScalar(0.8 + k * 1.4); ringMat.opacity = 0.7 * (1 - k); }
    if (grid.visible) gridMat.uniforms.uT.value = damp(gridMat.uniforms.uT.value, 1, 6, dt);
    if (units.length) {
      let n = 0;
      units = units.filter((u) => (u.age += dt) < u.life);
      for (const u of units) {
        if (u.age < 0) continue;
        u.v.y -= 9.8 * dt; u.p.addScaledVector(u.v, dt);
        u.r.x += u.w.x * dt; u.r.y += u.w.y * dt; u.r.z += u.w.z * dt;
        const gy = u.mode === "in" ? u.floor : 0.05;
        if (u.p.y < gy) { if (u.mode === "in") { u.age = u.life; continue; } u.p.y = gy; u.v.y = Math.abs(u.v.y) * 0.32; u.v.x *= 0.7; u.v.z *= 0.7; u.w.multiplyScalar(0.5); }
        const fade = u.mode === "out" ? Math.min(1, (u.life - u.age) * 2.5) : 1;
        dummy.position.copy(u.p); dummy.rotation.copy(u.r); dummy.scale.setScalar(fade); dummy.updateMatrix();
        unitMesh.setMatrixAt(n++, dummy.matrix);
        if (n >= 12) break;
      }
      unitMesh.count = n; unitMesh.instanceMatrix.needsUpdate = true;
    }
    if (!dirty) return;
    renderer.render(scene, camera);
    hooks.onFrame?.();
  }
  raf = requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) { cancelAnimationFrame(raf); running = false; }
    else if (!document.hidden && !running) { running = true; needsRender = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  });

  // ---- public api ----------------------------------------------------------------------
  return {
    bins, binById, buildings: B, lowPower, gpuName,
    info: () => renderer.info.render,
    invalidate: () => { needsRender = true; },
    setData({ departments, pieces: pcs, people: ppl, me }) {
      deptOf.clear(); for (const k of Object.keys(accents)) delete accents[k];
      for (const d of departments) { deptOf.set(d.id, d); accents[d.building] = d.accent; }
      pieces = pcs; pieceById.clear(); for (const pc of pieces) pieceById.set(pc.id, pc);
      people = ppl; myId = me;
      repaint();
    },
    intro(on) {
      introOn = on;
      if (!on) return;
      const [p, tg] = campusShot();
      if (reduceMotion.matches || lowPower) { camera.position.copy(p); controls.target.copy(tg); controls.update(); needsRender = true; return; }
      camera.position.set(p.x - 40, p.y + 70, p.z + 50); controls.target.copy(tg);
      const f = flyTo(p, tg, 4600, 0); if (f) f.ease = (k) => 1 - Math.pow(1 - k, 3);
    },
    assemble() { if (reduceMotion.matches || lowPower) return; for (const b of B) { b.assemble = 0; b.assembleT = 0; } buildingsDirty = true; },
    peek(id) { for (const b of B) if (b.target < 0.5) b.target = b.id === id ? 0.12 : 0; buildingsDirty = true; },
    campus(fly = true) {
      for (const b of B) b.target = 0;
      if (reduceMotion.matches) for (const b of B) { b.open = 0; b.vel = 0; }
      buildingsDirty = true; fitShadow(-2, -6, 58);
      if (fly) { const [p, tg] = campusShot(); flyTo(p, tg, 1900); }
    },
    enter(buildingId, fly = true) {
      const b = byB.get(buildingId);
      for (const x of B) x.target = x.id === buildingId ? 1 : 0;
      if (reduceMotion.matches) for (const x of B) { x.open = x.target; x.vel = 0; }
      buildingsDirty = true;
      fitShadow(b.x, b.z, Math.max(b.w, b.d) * 0.75 + 4);
      if (fly) { const [p, tg] = deptShot(buildingId); flyTo(p, tg, 2000); }
    },
    flyTo, overRoute, focus, select, showRoute, clearRoute, drop, setLabel, setBinVisible, project,
    setHeat(map) { heat = map; toteMat.color.set(map ? "#d8d8d8" : "#2a6db5"); repaint(); },
    setEdit(opts) {
      edit = opts;
      if (opts) { const b = byB.get(deptOf.get(opts.deptId).building); grid.scale.set(b.w - 0.4, b.d - 0.4, 1); grid.position.set(b.x, 0.025, b.z); gridMat.uniforms.uSize.value.set(b.w - 0.4, b.d - 0.4); gridMat.uniforms.uT.value = 0; grid.visible = true; }
      else { grid.visible = false; dragState = null; controls.enabled = true; }
      needsRender = true;
    },
    validPlacement, freeSpot, selectPiece,
    dropIn(id) { const a = anim(id); a.lift = 3.2; a.vy = 0; a.drop = true; a.liftTo = 0; a.scale = 0.5; a.scaleTo = 1; needsRender = true; },
    shrinkOut(id, done) { const a = anim(id); a.scaleTo = 0; a.done = done; needsRender = true; },
  };
}

// ---- geometry helpers -------------------------------------------------------------
function colored(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
function mergeAll(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) { const c = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2); o += c; }
  const m = new THREE.BufferGeometry();
  m.setAttribute("position", new THREE.BufferAttribute(pos, 3)); m.setAttribute("color", new THREE.BufferAttribute(col, 3)); m.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  m.computeVertexNormals();
  return m;
}
function treeCrownGeometry() {
  const parts = [];
  [[0, 2.6, 0, 1.9, "#3f6e33"], [0.9, 3.3, 0.3, 1.4, "#4f8040"], [-0.8, 3.5, -0.4, 1.3, "#456f37"], [0.1, 4.1, 0.1, 1.1, "#5a8a46"]].forEach(([x, y, z, r, c]) => { const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x, y, z); parts.push(colored(g, c)); });
  return mergeAll(parts);
}
function carGeometry() {
  const parts = [];
  const add = (w, h, d, y, z, color) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y + h / 2, z); parts.push(colored(g, color)); };
  add(1.8, 0.62, 4.3, 0.28, 0, "#ffffff"); add(1.6, 0.5, 2.2, 0.9, -0.2, "#20262e");
  for (const [x, z] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) { const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14); g.rotateZ(Math.PI / 2); g.translate(x, 0.33, z); parts.push(colored(g, "#141414")); }
  return mergeAll(parts);
}
function toteGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.01) { pos.setX(i, pos.getX(i) * 0.95); pos.setZ(i, pos.getZ(i) * 0.95); }
  const idx = g.index.array, top = g.groups[2];
  for (let k = top.start; k < top.start + top.count; k++) idx[k] = idx[top.start];
  g.computeVertexNormals();
  return g;
}
function chaikin(pts, iterations) {
  let p = pts.map(([x, z]) => new THREE.Vector2(x, z));
  for (let it = 0; it < iterations; it++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; out.push(a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75)); }
    out.push(p[p.length - 1]); p = out;
  }
  return p;
}
function ribbon(pts, width) {
  const pos = [], uv = [], idx = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = b.clone().sub(a).normalize(), n = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(width / 2);
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    pos.push(pts[i].x + n.x, 0, pts[i].y + n.y, pts[i].x - n.x, 0, pts[i].y - n.y);
    uv.push(len, 0, len, 1);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.userData.length = len;
  return g;
}
function radialTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.45, "rgba(255,255,255,.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

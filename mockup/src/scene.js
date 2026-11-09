// Verlet's floor in its building: the open hall from the walk-through video
// (columns, yellow walls, glazing, frosted partitions, pine shelving), the
// department zones on it, furniture and people, inside a block whose other
// storeys lift away when you go in.
//
// Budget (Intel UHD laptop): one shadow-casting sun refitted to the view,
// instancing for every repeated thing, pixel ratio capped, frames only when
// something moves, low-power profile on software GL.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as T from "./textures.js";
import { kitGeometry, avatarGeometry, shirtGeometry, KINDS } from "./kit.js";
import { RACKS, BAYS, LEVELS, SIDES, KIT } from "./data.js";
import { TOWER, BELOW, ABOVE, GROUND_Y, CEILING, AREA, GRID, COLUMN, DOOR, LIFTS, WALKWAY_Z, ROOMS, SHELVING, TREES } from "./site.js";

const FH = TOWER.floorHeight, PL = TOWER.plate;
const PW = PL.x1 - PL.x0, PD = PL.z1 - PL.z0, PCX = (PL.x0 + PL.x1) / 2, PCZ = (PL.z0 + PL.z1) / 2;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function easeOutBounce(x) { const n1 = 7.5625, d1 = 2.75; if (x < 1 / d1) return n1 * x * x; if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75; if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375; return n1 * (x -= 2.625 / d1) * x + 0.984375; }
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// columns on the grid inside Verlet's area (also obstacles for the layout editor)
export const COLUMNS = [];
for (let x = AREA.x0 + GRID; x < AREA.x1 - 0.1; x += GRID) for (let z = AREA.z0 + GRID; z < AREA.z1 - 0.1; z += GRID) COLUMNS.push([x, z]);

// stockroom shelving: each rack is a run of bays along a wall; front faces into the room
const SH = SHELVING;
const RACK = Object.fromEntries(SH.racks.map((r) => {
  const along = r.dir === "east" ? [1, 0] : [0, 1];
  const front = r.dir === "east" ? [0, 1] : [1, 0];
  return [r.name, { ...r, along, front, len: SH.bayW * BAYS }];
}));
const rackPoint = (r, u, v) => [r.x + r.along[0] * u + r.front[0] * v, r.z + r.along[1] * u + r.front[1] * v];
const rackRot = (r) => (r.dir === "east" ? 0 : Math.PI / 2);

// world-space UVs so one texture reads at true scale on any scaled instance
function worldUV(mat, mode, tile) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTile = { value: tile };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTile;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec4 wuv = modelMatrix * instanceMatrix * vec4(position, 1.0);
      #else
        vec4 wuv = modelMatrix * vec4(position, 1.0);
      #endif
      vec3 wn = normalize(mat3(modelMatrix) * normal);
      vec2 tuv = ${mode === "wall" ? "(abs(wn.x) > 0.5 ? vec2(wuv.z, wuv.y) : abs(wn.y) > 0.5 ? wuv.xz : vec2(wuv.x, wuv.y)) * uTile" : "wuv.xz * uTile"};
      #ifdef USE_MAP
        vMapUv = tuv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = tuv;
      #endif`);
  };
  mat.customProgramCacheKey = () => `wuv-${mode}-${tile}`;
  return mat;
}

export function createScene(canvas, hooks) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  const lowPower = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuName);
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color("#a99a8c"), 140, 480);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  camera.position.set(60, 30, 80);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.075, minDistance: 2.2, maxDistance: 150, maxPolarAngle: Math.PI * 0.49, zoomSpeed: 0.8, rotateSpeed: 0.55 });
  controls.target.set(PCX, GROUND_Y + 8, PCZ);
  controls.addEventListener("change", () => {
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, PL.x0 - 30, PL.x1 + 30); t.z = THREE.MathUtils.clamp(t.z, PL.z0 - 30, PL.z1 + 40); t.y = THREE.MathUtils.clamp(t.y, GROUND_Y - 2, 8);
  });

  // ---- sky dome with a sun glow, fog-free --------------------------------------
  const sunDir = new THREE.Vector3();
  { const az = THREE.MathUtils.degToRad(35), el = THREE.MathUtils.degToRad(38); sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize(); }
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir }, uTop: { value: new THREE.Color("#4a6687") }, uHorizon: { value: new THREE.Color("#d9c8b4") }, uGround: { value: new THREE.Color("#a99a8c") } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec3 vDir; uniform vec3 uSun, uTop, uHorizon, uGround;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.5)) : mix(uHorizon, uGround, pow(-h, 0.4));
        float s = max(dot(normalize(vDir), uSun), 0.0); c += vec3(1.0, 0.85, 0.65) * (pow(s, 80.0) * 1.0 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  // ---- lights -----------------------------------------------------------------
  const hemi = new THREE.HemisphereLight("#dfe6ef", "#7a6a58", 0.75);
  const sun = new THREE.DirectionalLight("#fff0dc", 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(lowPower ? 1024 : 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);
  let needsRender = true;
  function fitShadow(cx, cy, cz, radius) {
    sun.target.position.set(cx, cy, cz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, radius * 3 + 50);
    const sc = sun.shadow.camera;
    sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 1; sc.far = radius * 6 + 120;
    sc.updateProjectionMatrix();
    needsRender = true;
  }

  // ---- materials ------------------------------------------------------------------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1), e3 = new THREE.Euler();
  const compose = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => { q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry); return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)); };
  const place = (mesh, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => mesh.setMatrixAt(i, compose(x, y, z, sx, sy, sz, ry));
  const shade = (o, cast = true) => { o.castShadow = cast; o.receiveShadow = true; return o; };
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const tile = T.tiles();
  const tileMat = worldUV(new THREE.MeshStandardMaterial({ map: tile.map, roughnessMap: tile.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 1.3 }), "floor", 1 / 0.6);
  const greyFloorMat = worldUV(new THREE.MeshStandardMaterial({ map: tile.map, roughness: 0.5, color: "#9d9a95" }), "floor", 1 / 0.6);
  const grassMat = worldUV(new THREE.MeshStandardMaterial({ map: T.grass(), roughness: 0.95 }), "floor", 0.09);
  const curtainMat = worldUV(new THREE.MeshStandardMaterial({ map: T.curtainWall(), metalness: 0.55, roughness: 0.12, envMapIntensity: 1.6 }), "wall", 1 / 1.5);
  const slabEdgeMat = new THREE.MeshStandardMaterial({ color: "#d9d6cf", roughness: 0.8 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: "#e9c62b", roughness: 0.85 });
  const greenMat = new THREE.MeshStandardMaterial({ color: "#a9b98a", roughness: 0.85 });
  const columnMat = new THREE.MeshStandardMaterial({ color: "#8fb0bd", roughness: 0.8 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: "#f2f2ef", roughness: 0.9, side: THREE.DoubleSide });
  const ledMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const alumMat = new THREE.MeshStandardMaterial({ color: "#d4d8dc", roughness: 0.35, metalness: 0.7 });
  const clearGlass = new THREE.MeshStandardMaterial({ color: "#a9c4d4", transparent: true, opacity: 0.28, metalness: 0.2, roughness: 0.05, envMapIntensity: 1.6, depthWrite: false });
  const frostMat = new THREE.MeshStandardMaterial({ map: T.frosted(), transparent: true, roughness: 0.5, depthWrite: false });
  const louvreMat = new THREE.MeshStandardMaterial({ color: "#e9ebec", roughness: 0.6 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: "#c7c2ba", roughness: 0.9 });
  const pineMat = new THREE.MeshStandardMaterial({ color: "#d9b07a", roughness: 0.7 });
  const pineDark = new THREE.MeshStandardMaterial({ color: "#c69a62", roughness: 0.75 });
  const cardMat = new THREE.MeshStandardMaterial({ map: T.cardboard(), roughness: 0.92 });
  const trayMat = new THREE.MeshStandardMaterial({ color: "#f1f1ee", roughness: 0.5, side: THREE.DoubleSide });
  const kitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });

  function instanced(geo, mat, parts, cast = true) {
    const mesh = shade(new THREE.InstancedMesh(geo, mat, Math.max(1, parts.length)), cast);
    parts.forEach((p, i) => { p.mesh = mesh; p.i = i; mesh.setMatrixAt(i, p.m); });
    mesh.count = parts.length;
    scene.add(mesh);
    return mesh;
  }

  // ---- street level ------------------------------------------------------------------
  const ground = shade(new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), grassMat), false);
  ground.rotation.x = -Math.PI / 2; ground.position.set(PCX, GROUND_Y - 0.02, PCZ);
  const SB = { x0: PL.x0 - 40, x1: PL.x1 + 40, z0: PL.z0 - 20, z1: TOWER.street.z + 12 };
  const street = shade(new THREE.Mesh(new THREE.PlaneGeometry(SB.x1 - SB.x0, SB.z1 - SB.z0), new THREE.MeshStandardMaterial({ map: T.streetDecals(SB, PL, TOWER.street), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })), false);
  street.rotation.x = -Math.PI / 2; street.position.set((SB.x0 + SB.x1) / 2, GROUND_Y - 0.005, (SB.z0 + SB.z1) / 2);
  scene.add(ground, street);
  const trunk = shade(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.22, 2.6, 8), new THREE.MeshStandardMaterial({ color: "#5a4636", roughness: 0.9 }), TREES.length));
  const crown = shade(new THREE.InstancedMesh(treeCrownGeometry(), kitMat, TREES.length));
  TREES.forEach(([x, z], i) => { const s = 0.85 + hash(i + 3) * 0.5; place(trunk, i, x, GROUND_Y + 1.3 * s, z, s, s, s); place(crown, i, x, GROUND_Y + 2.2 * s, z, s, s, s, hash(i) * 6); });
  const cars = shade(new THREE.InstancedMesh(carGeometry(), kitMat, 4));
  [[-6, 1], [14, -1], [26, 1], [44, -1]].forEach(([x, side], i) => place(cars, i, x, GROUND_Y, TOWER.street.z + side * 2.2, 1, 1, 1, Math.PI / 2 + (side > 0 ? Math.PI : 0)));
  cars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12), 3);
  ["#d7d7d4", "#2c3e57", "#8a1c1c", "#1d1f22"].forEach((c, i) => cars.setColorAt(i, new THREE.Color(c)));
  scene.add(trunk, crown, cars);

  // ---- the block: storeys below and above Verlet's, as glass boxes with slab bands --
  // each part remembers which storey it belongs to (k < 0 below, k > 0 above, 0 = Verlet)
  const storeyParts = [], bandParts = [], roofParts = [];
  for (let k = -BELOW; k <= ABOVE; k++) {
    const y0 = k * FH;
    bandParts.push({ k, m: compose(PCX, y0 - 0.2, PCZ, PW + 0.4, 0.4, PD + 0.4) });
    if (k !== 0) storeyParts.push({ k, m: compose(PCX, y0 + FH / 2, PCZ, PW, FH - 0.4, PD) });
  }
  const topY = (ABOVE + 1) * FH;
  roofParts.push({ k: ABOVE + 1, m: compose(PCX, topY - 0.2, PCZ, PW + 0.4, 0.4, PD + 0.4) });
  for (const [x, z, w, d] of [[PCX, PL.z1, PW + 0.4, 0.25], [PCX, PL.z0, PW + 0.4, 0.25], [PL.x0, PCZ, 0.25, PD], [PL.x1, PCZ, 0.25, PD]]) roofParts.push({ k: ABOVE + 1, m: compose(x, topY + 0.4, z, w, 0.8, d) });
  roofParts.push({ k: ABOVE + 1, m: compose(PCX + 10, topY + 1.1, PCZ - 3, 6, 1.6, 4) }, { k: ABOVE + 1, m: compose(PCX - 12, topY + 0.8, PCZ + 2, 3, 1.0, 3) });
  const storeyMesh = instanced(unit, curtainMat, storeyParts);
  const bandMesh = instanced(unit, slabEdgeMat, bandParts);
  const roofMesh = instanced(unit, concreteMat, roofParts);
  // ground-floor entrance canopy
  const canopy = shade(new THREE.Mesh(unit, alumMat)); canopy.scale.set(10, 0.3, 3.5); canopy.position.set(LIFTS.x, GROUND_Y + 3.4, PL.z1 + 1.7); scene.add(canopy);

  // ---- Verlet's storey: the facade round the whole plate (it drops to sill height inside)
  const facadeParts = [];
  const bay = 3;
  for (const side of ["north", "south", "west", "east"]) {
    const alongX = side === "north" || side === "south";
    const len = alongX ? PW : PD, n = Math.round(len / bay);
    for (let i = 0; i < n; i++) {
      const t = (alongX ? PL.x0 : PL.z0) + (i + 0.5) * (len / n);
      const x = alongX ? t : side === "west" ? PL.x0 : PL.x1, z = alongX ? (side === "north" ? PL.z0 : PL.z1) : t;
      facadeParts.push({ side, m: compose(x, FH / 2 - 0.2, z, alongX ? len / n - 0.02 : 0.12, FH - 0.4, alongX ? 0.12 : len / n - 0.02) });
    }
  }
  const facadeMesh = instanced(unit, curtainMat, facadeParts, false);
  // Verlet's slice of the facade gets a band in the brand pink, so you can spot the floor
  const verletBand = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ color: "#ff5c95", emissive: "#ff5c95", emissiveIntensity: 0.35, roughness: 0.5 }));
  verletBand.scale.set(AREA.x1 - AREA.x0 + 0.4, 0.22, 0.3); verletBand.position.set((AREA.x0 + AREA.x1) / 2, -0.06, PL.z1 + 0.05);
  scene.add(verletBand);

  // ---- floor finishes: Verlet's tiles, the rest of the floor grey ----------------
  const vFloor = shade(new THREE.Mesh(new THREE.PlaneGeometry(AREA.x1 - AREA.x0, AREA.z1 - AREA.z0), tileMat), false);
  vFloor.rotation.x = -Math.PI / 2; vFloor.position.set((AREA.x0 + AREA.x1) / 2, 0.002, (AREA.z0 + AREA.z1) / 2);
  const oFloor = shade(new THREE.Mesh(new THREE.PlaneGeometry(PL.x1 - AREA.x1, PD), greyFloorMat), false);
  oFloor.rotation.x = -Math.PI / 2; oFloor.position.set((AREA.x1 + PL.x1) / 2, 0.001, PCZ);
  const plateEdge = shade(new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), greyFloorMat), false);
  plateEdge.rotation.x = -Math.PI / 2; plateEdge.position.set(PCX, -0.001, PCZ);
  scene.add(vFloor, oFloor, plateEdge);

  // ---- Verlet's hall: yellow walls (N, W) with a green bulkhead, columns, partition ----
  const wallParts = [], bulkParts = [];
  const WT = 0.2;
  wallParts.push({ m: compose((AREA.x0 + AREA.x1) / 2, CEILING / 2, AREA.z0 + WT / 2, AREA.x1 - AREA.x0, CEILING, WT) });
  wallParts.push({ m: compose(AREA.x0 + WT / 2, CEILING / 2, (AREA.z0 + AREA.z1) / 2, WT, CEILING, AREA.z1 - AREA.z0) });
  bulkParts.push({ m: compose((AREA.x0 + AREA.x1) / 2, CEILING - 0.25, AREA.z0 + WT + 0.01, AREA.x1 - AREA.x0, 0.5, 0.02) });
  bulkParts.push({ m: compose(AREA.x0 + WT + 0.01, CEILING - 0.25, (AREA.z0 + AREA.z1) / 2, 0.02, 0.5, AREA.z1 - AREA.z0) });
  const wallMesh = instanced(unit, yellowMat, wallParts);
  const bulkMesh = instanced(unit, greenMat, bulkParts, false);
  const colMesh = instanced(unit, columnMat, COLUMNS.map(([x, z]) => ({ m: compose(x, CEILING / 2, z, COLUMN, CEILING, COLUMN) })));
  // south: the glazing sits in the facade; add the louvred top band and a sill on the inside
  const louvreParts = [], sillParts = [];
  for (let x = AREA.x0 + 0.75; x < AREA.x1; x += 1.5) {
    for (let k = 0; k < 6; k++) louvreParts.push({ m: compose(x, CEILING - 0.08 - k * 0.07, AREA.z1 - 0.12, 1.42, 0.03, 0.06) });
  }
  sillParts.push({ m: compose((AREA.x0 + AREA.x1) / 2, 0.05, AREA.z1 - 0.15, AREA.x1 - AREA.x0, 0.1, 0.12) });
  const louvreMesh = instanced(unit, louvreMat, louvreParts, false);
  const sillMesh = instanced(unit, alumMat, sillParts, false);
  // east: frosted partition panels with aluminium mullions, double door at DOOR
  const partParts = [], mullParts = [];
  for (let z = AREA.z0 + 0.6; z < AREA.z1; z += 1.2) {
    if (Math.abs(z - DOOR.z) < DOOR.w / 2 + 0.05) continue;
    partParts.push({ m: compose(AREA.x1, CEILING / 2, z, 0.03, CEILING, 1.18) });
  }
  for (let z = AREA.z0; z <= AREA.z1 + 0.01; z += 1.2) mullParts.push({ m: compose(AREA.x1, CEILING / 2, z, 0.06, CEILING, 0.05) });
  mullParts.push({ m: compose(AREA.x1, CEILING - 0.02, (AREA.z0 + AREA.z1) / 2, 0.08, 0.05, AREA.z1 - AREA.z0) });
  const partMesh = instanced(new THREE.BoxGeometry(1, 1, 1), frostMat, partParts, false);
  const mullMesh = instanced(unit, alumMat, mullParts, false);
  const doorLeaves = instanced(unit, clearGlass, [{ m: compose(AREA.x1, 1.1, DOOR.z - DOOR.w / 4, 0.04, 2.2, DOOR.w / 2 - 0.04) }, { m: compose(AREA.x1, 1.1, DOOR.z + DOOR.w / 4, 0.04, 2.2, DOOR.w / 2 - 0.04) }], false);
  // the rest of the floor: lift core, a frosted office row, a sign
  const core = shade(new THREE.Mesh(unit, concreteMat)); core.scale.set(6, CEILING, 5); core.position.set(LIFTS.x + 1, CEILING / 2, LIFTS.z - 4.2); scene.add(core);
  const liftDoors = instanced(unit, alumMat, [{ m: compose(LIFTS.x - 0.6, 1.1, LIFTS.z - 1.68, 1.0, 2.2, 0.05) }, { m: compose(LIFTS.x + 2.0, 1.1, LIFTS.z - 1.68, 1.0, 2.2, 0.05) }], false);
  const otherParts = [];
  for (let x = AREA.x1 + 3; x < PL.x1 - 1; x += 1.2) otherParts.push({ m: compose(x, CEILING / 2, 6, 1.18, CEILING, 0.03) });
  const otherMesh = instanced(new THREE.BoxGeometry(1, 1, 1), frostMat, otherParts, false);

  // ---- ceiling group: white ceiling, flat LED panels, green beams on the column lines
  // (it goes with the storey above when the floors lift)
  const ceilParts = [{ m: compose(PCX, CEILING + 0.01, PCZ, PW, 0.02, PD) }];
  const beamParts = [];
  for (let x = AREA.x0 + GRID; x < AREA.x1; x += GRID) beamParts.push({ m: compose(x, CEILING - 0.18, (AREA.z0 + AREA.z1) / 2, 0.45, 0.36, AREA.z1 - AREA.z0) });
  for (let z = AREA.z0 + GRID; z < AREA.z1; z += GRID) beamParts.push({ m: compose((AREA.x0 + AREA.x1) / 2, CEILING - 0.18, z, AREA.x1 - AREA.x0, 0.36, 0.45) });
  const ledParts = [];
  for (let x = AREA.x0 + 3; x < AREA.x1; x += GRID) for (let z = AREA.z0 + 3; z < AREA.z1; z += GRID) ledParts.push({ m: compose(x, CEILING - 0.005, z, 1.2, 0.01, 0.3) });
  const ceilMesh = instanced(unit, ceilingMat, ceilParts, false);
  const beamMesh = instanced(unit, greenMat, beamParts, false);
  const ledMesh = instanced(unit, ledMat, ledParts, false);
  const ceilingGroup = [[ceilMesh, ceilParts], [beamMesh, beamParts], [ledMesh, ledParts]];

  // ---- zones: a soft tint and a drawn border per department -----------------------
  const B = ROOMS.map((r, i) => ({ ...r, idx: i, open: 0, H: CEILING }));
  const byB = new Map(B.map((b) => [b.id, b]));
  const zoneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 } },
    vertexShader: `attribute vec3 aColor; attribute vec3 aSize; varying vec2 vP; varying vec3 vC; varying vec3 vS;
      void main(){ vP = position.xy; vC = aColor; vS = aSize; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vP; varying vec3 vC; varying vec3 vS; uniform float uT;
      void main(){ vec2 d = (0.5 - abs(vP)) * vS.xy; float e = min(d.x, d.y);
        float line = smoothstep(0.16, 0.05, e) * smoothstep(-0.02, 0.02, e);
        float dash = step(0.5, fract((vP.x * vS.x + vP.y * vS.y) * 0.8));
        float glow = vS.z;
        float a = (line * (0.5 + 0.35 * glow) * (0.65 + 0.35 * dash) + 0.018 + 0.05 * glow) * uT;
        gl_FragColor = vec4(vC, a); }`,
  });
  const zoneGeo = new THREE.PlaneGeometry(1, 1);
  const zoneColor = new THREE.InstancedBufferAttribute(new Float32Array(B.length * 3), 3);
  const zoneSize = new THREE.InstancedBufferAttribute(new Float32Array(B.length * 3), 3);
  zoneGeo.setAttribute("aColor", zoneColor); zoneGeo.setAttribute("aSize", zoneSize);
  const zoneMesh = new THREE.InstancedMesh(zoneGeo, zoneMat, B.length);
  B.forEach((b, i) => { q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); zoneMesh.setMatrixAt(i, m4.compose(v.set(b.x, 0.012, b.z), q, sv.set(b.w, b.d, 1))); zoneSize.setXYZ(i, b.w, b.d, 0); b.zi = i; });
  zoneMesh.renderOrder = 1;
  scene.add(zoneMesh);
  // light curtains: when you open a zone its border rises as a glowing wall, then settles
  const curtainMatZ = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color("#ff5c95") }, uRise: { value: 0 } },
    vertexShader: "varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying float vY; uniform vec3 uColor; uniform float uRise; void main(){ float h = uRise * 2.6; if (vY > h) discard; float a = (1.0 - vY / max(h, 0.001)) * 0.55 * min(1.0, uRise * 3.0); gl_FragColor = vec4(uColor * a, a); }",
  });
  const zoneCurtain = new THREE.Mesh(new THREE.BufferGeometry(), curtainMatZ);
  zoneCurtain.visible = false; zoneCurtain.renderOrder = 3; scene.add(zoneCurtain);
  let curtain = null;
  function raiseCurtain(b, color) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, H = 2.6;
    const P = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]], pos = [];
    for (let i = 0; i < 4; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1]; pos.push(ax, 0, az, bx, 0, bz, bx, H, bz, ax, 0, az, bx, H, bz, ax, H, az); }
    zoneCurtain.geometry.dispose();
    zoneCurtain.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    curtainMatZ.uniforms.uColor.value.set(color);
    curtain = { t: 0 }; zoneCurtain.visible = !reduceMotion.matches;
  }

  // ---- stockroom shelving: pine units in an L along the yellow walls ------------------
  const nUp = SH.racks.length * (BAYS + 1) * 2, nSh = SH.racks.length * BAYS * (LEVELS + 1);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, SH.height, 0.05), pineMat, nUp);
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(SH.bayW - 0.04, 0.03, SH.depth), pineMat, nSh);
  const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(SH.bayW, SH.height, 0.015), pineDark, SH.racks.length * BAYS);
  let ip = 0, ibd = 0, ibk = 0;
  for (const r of Object.values(RACK)) {
    const rot = rackRot(r);
    for (let k = 0; k <= BAYS; k++) for (const vv of [-SH.depth / 2, SH.depth / 2]) { const [x, z] = rackPoint(r, k * SH.bayW, vv); place(posts, ip++, x, SH.height / 2, z, 1, 1, 1, rot); }
    for (let k = 0; k < BAYS; k++) {
      const [bx, bz] = rackPoint(r, (k + 0.5) * SH.bayW, -SH.depth / 2 + 0.01); place(backs, ibk++, bx, SH.height / 2, bz, 1, 1, 1, rot);
      for (const y of [...SH.levels, SH.height - 0.04]) { const [x, z] = rackPoint(r, (k + 0.5) * SH.bayW, 0); place(boards, ibd++, x, y, z, 1, 1, 1, rot); }
    }
  }
  for (const mesh of [posts, boards, backs]) scene.add(shade(mesh));

  // boxes: cardboard cartons or white parts trays, one printed label each
  const bins = [];
  for (const r of Object.values(RACK)) for (let b = 1; b <= BAYS; b++) for (let l = 1; l <= LEVELS; l++) for (const sd of SIDES) {
    const i = bins.length, tray = hash(i) < 0.28;
    const h = tray ? 0.16 : 0.26 + hash(i + 7) * 0.2, w = tray ? 0.44 : 0.4 + hash(i + 3) * 0.06, d = tray ? 0.38 : 0.36;
    const u = (b - 0.5) * SH.bayW + (sd === "L" ? -0.25 : 0.25) + (hash(i + 5) - 0.5) * 0.03;
    const [x, z] = rackPoint(r, u, (hash(i + 9) - 0.5) * 0.03 + 0.02);
    const rot = rackRot(r) + (hash(i + 11) - 0.5) * 0.06;
    bins.push({ id: `bin-${r.name}-${b}-${l}-${sd}`, code: `${r.name}-${b}-${l}-${sd}`, rack: r.name, bay: b, level: l, side: sd, x, z, y: SH.levels[l - 1] + 0.015 + h / 2, w, h, d, rot, kind: tray ? "tray" : "card", front: r.front });
  }
  const cardBins = bins.filter((b) => b.kind === "card"), trayBins = bins.filter((b) => b.kind === "tray");
  const cardMesh = new THREE.InstancedMesh(unit, cardMat, cardBins.length);
  const trayMesh = new THREE.InstancedMesh(trayGeometry(), trayMat, trayBins.length);
  cardBins.forEach((b, i) => { b.mesh = cardMesh; b.instance = i; place(cardMesh, i, b.x, b.y, b.z, b.w, b.h, b.d, b.rot); });
  trayBins.forEach((b, i) => { b.mesh = trayMesh; b.instance = i; place(trayMesh, i, b.x, b.y - b.h / 2, b.z, b.w, b.h, b.d, b.rot); });
  for (const mesh of [cardMesh, trayMesh]) { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3).fill(1), 3); scene.add(shade(mesh)); }
  const binById = new Map(bins.map((b) => [b.id, b]));
  for (const b of bins) { b.base = new THREE.Matrix4(); b.mesh.getMatrixAt(b.instance, b.base); b.visible = true; }

  const atlas = new T.LabelAtlas(bins.length);
  const labelMat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 });
  const labelGeo = new THREE.PlaneGeometry(0.24, 0.12);
  const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(bins.length * 2), 2);
  labelGeo.setAttribute("aCell", cellAttr);
  labelMat.onBeforeCompile = (sh) => {
    sh.uniforms.uN = { value: atlas.N };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aCell;\nuniform float uN;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (uv + aCell) / uN;\n#endif");
  };
  const labels = new THREE.InstancedMesh(labelGeo, labelMat, bins.length);
  bins.forEach((b, i) => {
    const [cx, cy] = atlas.cellUV(i); cellAttr.setXY(i, cx, cy);
    const off = b.d / 2 + 0.004;
    place(labels, i, b.x + b.front[0] * off, b.kind === "tray" ? b.y - b.h * 0.05 : b.y - b.h * 0.12, b.z + b.front[1] * off, 1, 1, 1, b.rot);
    b.label = i; b.labelBase = new THREE.Matrix4(); labels.getMatrixAt(i, b.labelBase);
  });
  labels.receiveShadow = true;
  scene.add(labels);

  // ---- furniture: one instanced mesh per kind -----------------------------------------
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
  const tone = { ok: new THREE.Color(1, 1, 1), hover: new THREE.Color(1.3, 1.24, 1.26), good: new THREE.Color("#5fbf7f"), fair: new THREE.Color("#e6b44a"), poor: new THREE.Color("#e2574c"), empty: new THREE.Color(0.35, 0.35, 0.37) };
  const MINE = new THREE.Color(1.25, 1.08, 1.16), BAD = new THREE.Color(1.7, 0.5, 0.5);
  function pieceWorld(pc) {
    const b = byB.get(deptOf.get(pc.dept)?.building); if (!b) return null;
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
  const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
  function layoutPieces() {
    for (const mesh of Object.values(kitMeshes)) { mesh.count = 0; mesh.userData.slots = []; }
    for (const pc of pieces) {
      const mesh = kitMeshes[pc.kind]; if (!mesh) continue;
      const w = pieceWorld(pc); if (!w) continue;
      const i = mesh.count++;
      mesh.userData.slots[i] = pc.id;
      mesh.setMatrixAt(i, compose(w.x, w.y, w.z, w.scale, w.scale, w.scale, w.rot));
      mesh.setColorAt(i, pieceTint(pc));
    }
    for (const mesh of Object.values(kitMeshes)) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); }
    if (outlinePiece) placeOutline(outlinePiece);
    layoutAvatars();
    needsRender = true;
  }

  // ---- people ---------------------------------------------------------------------------
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
    return { x: b.x - b.w / 2 + 1.2 + k * 0.8, z: b.z + (b.z < WALKWAY_Z ? b.d / 2 - 0.8 : -b.d / 2 + 0.8), rot: 0, b };
  }
  function layoutAvatars() {
    avatarMesh.count = shirtMesh.count = 0; avatarMesh.userData.slots = []; shirtMesh.userData.slots = [];
    people.forEach((p, k) => {
      const s = avatarSpot(p); if (!s) return;
      const i = avatarMesh.count++; shirtMesh.count++;
      avatarMesh.userData.slots[i] = shirtMesh.userData.slots[i] = p.id;
      const m = compose(s.x, 0, s.z, 1, 1, 1, s.rot);
      avatarMesh.setMatrixAt(i, m); shirtMesh.setMatrixAt(i, m);
      shirtMesh.setColorAt(i, new THREE.Color(PALETTE[k % PALETTE.length]).multiplyScalar(hover?.type === "person" && hover.id === p.id ? 1.35 : 0.9));
    });
    for (const mm of [avatarMesh, shirtMesh]) { mm.instanceMatrix.needsUpdate = true; mm.computeBoundingSphere(); }
    shirtMesh.instanceColor.needsUpdate = true;
  }

  // ---- overlays -------------------------------------------------------------------------
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: "#ff5c95", transparent: true }));
  outline.visible = false; scene.add(outline);
  const ringMat = new THREE.MeshBasicMaterial({ color: "#ff5c95", transparent: true, opacity: 0.6, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 48), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false; scene.add(ring);
  const routeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uColor: { value: new THREE.Color("#ff5c95") } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec2 vUv; uniform float uTime, uReveal; uniform vec3 uColor;
      void main(){ if (vUv.x > uReveal) discard;
        float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        float chev = fract(vUv.x * 1.2 - uTime * 1.1 - abs(vUv.y - 0.5) * 0.9);
        float dash = smoothstep(0.0, 0.08, chev) * smoothstep(0.62, 0.5, chev);
        float head = smoothstep(uReveal - 1.2, uReveal, vUv.x);
        gl_FragColor = vec4(uColor, edge * (0.25 + dash * 0.7 + head * 0.3)); }`,
  });
  const route = new THREE.Mesh(new THREE.BufferGeometry(), routeMat);
  route.position.y = 0.03; route.visible = false; route.renderOrder = 2; scene.add(route);
  let routeLen = 1;
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
  grid.rotation.x = -Math.PI / 2; grid.position.y = 0.02; grid.visible = false; grid.renderOrder = 1; scene.add(grid);
  const unitMesh = shade(new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.08, 0.1), cardMat, 12));
  unitMesh.count = 0; scene.add(unitMesh);
  let units = [];

  // ---- colour state ---------------------------------------------------------------------
  let hover = null, selected = null, introOn = false, focusZone = null;
  const binColor = (b) => {
    if (heat) { const h = heat[b.id]; if (h == null) return tone.empty; return h >= 0.97 ? tone.good : h >= 0.8 ? tone.fair : tone.poor; }
    if (hover?.type === "bin" && hover.id === b.id && selected?.id !== b.id) return tone.hover;
    return tone.ok;
  };
  function repaint() {
    for (const b of bins) b.mesh.setColorAt(b.instance, binColor(b));
    cardMesh.instanceColor.needsUpdate = trayMesh.instanceColor.needsUpdate = true;
    for (const b of B) {
      const c = new THREE.Color(accents[b.id] || "#888");
      zoneColor.setXYZ(b.zi, c.r, c.g, c.b);
      zoneSize.setZ(b.zi, focusZone === b.id ? 1 : hover?.type === "building" && hover.id === b.id ? 0.7 : 0);
    }
    zoneColor.needsUpdate = zoneSize.needsUpdate = true;
    layoutPieces();
  }

  // ---- the storey animation: assemble on load, lift the floors above to go in ------------
  // tower.open: 0 = outside, 1 = inside Verlet's floor
  const tower = { open: 0, vel: 0, target: 0, assemble: 1, assembleT: null };
  let towerDirty = true;
  const S = new THREE.Matrix4(), M = new THREE.Matrix4(), R = new THREE.Matrix4(), Tm = new THREE.Matrix4(), Ti = new THREE.Matrix4();
  function storeyOffset(k) {
    // storeys above Verlet's lift in sequence, highest first, tilting slightly as they go
    const o = tower.open;
    if (k <= 0) return null;
    const delay = (ABOVE + 1 - k) * 0.08, ok = Math.min(1, Math.max(0, (o - delay) / (1 - delay)));
    return { lift: ok * (8 + k * 6), tilt: ok * 0.08 * k, shrink: 1 - smooth(0.7, 1, ok) };
  }
  function assembleOffset(k) {
    // on load the block builds up storey by storey from the street
    if (tower.assemble >= 1) return { drop: 0, scale: 1 };
    const t = tower.assembleT - (k + BELOW) * 0.16;
    const a = Math.min(1, Math.max(0, t / 0.9));
    return { drop: (1 - easeOutBounce(a)) * 12, scale: a > 0 ? 1 : 0.0001 };
  }
  function storeyMatrix(k, base) {
    const as = assembleOffset(k), so = storeyOffset(k);
    let lift = as.drop, tilt = 0, shrink = as.scale;
    if (so) { lift += so.lift; tilt = so.tilt; shrink *= so.shrink; }
    shrink = Math.max(0.0001, shrink);
    const cy = k * FH;
    Tm.makeTranslation(PCX, cy + lift, PCZ); Ti.makeTranslation(-PCX, -cy, -PCZ);
    e3.set(tilt * 0.4, tilt, 0); R.makeRotationFromEuler(e3);
    S.makeScale(shrink, shrink, shrink);
    return M.copy(Tm).multiply(R).multiply(S).multiply(Ti).multiply(base);
  }
  function updateTower(dt) {
    let moving = false;
    const k = 60, c = 2 * Math.sqrt(k) * 0.8;
    tower.vel += (k * (tower.target - tower.open) - c * tower.vel) * dt; tower.open += tower.vel * dt;
    if (Math.abs(tower.target - tower.open) < 0.0005 && Math.abs(tower.vel) < 0.0005) { tower.open = tower.target; tower.vel = 0; } else moving = true;
    if (tower.assembleT != null) { tower.assembleT += dt; tower.assemble = Math.min(1, tower.assembleT / ((BELOW + ABOVE + 2) * 0.16 + 0.9)); if (tower.assemble >= 1) tower.assembleT = null; moving = true; }
    if (curtain) { curtain.t += dt; curtainMatZ.uniforms.uRise.value = curtain.t < 0.6 ? easeOutBounce(curtain.t / 0.6) : Math.max(0, 1 - (curtain.t - 1.2) / 0.8); if (curtain.t > 2.0) { curtain = null; zoneCurtain.visible = false; } moving = true; }
    if (!moving && !towerDirty) return false;
    towerDirty = false;
    for (const p of storeyParts) storeyMesh.setMatrixAt(p.i, storeyMatrix(p.k, p.m));
    for (const p of bandParts) bandMesh.setMatrixAt(p.i, storeyMatrix(p.k, p.m));
    for (const p of roofParts) roofMesh.setMatrixAt(p.i, storeyMatrix(p.k, p.m));
    // Verlet's ceiling rides with the storey above
    for (const [mesh, parts] of ceilingGroup) for (const p of parts) mesh.setMatrixAt(p.i, storeyMatrix(1, p.m));
    // Verlet's facade drops to sill height; the pink band stays
    const o = Math.min(1, Math.max(0, tower.open)), as0 = assembleOffset(0);
    for (const p of facadeParts) { S.makeScale(1, Math.max(0.0001, (1 - o * 0.78) * as0.scale), 1); facadeMesh.setMatrixAt(p.i, M.multiplyMatrices(S, p.m)); }
    for (const mesh of [storeyMesh, bandMesh, roofMesh, facadeMesh, ceilMesh, beamMesh, ledMesh]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
    zoneMat.uniforms.uT.value = smooth(0.5, 1, o);
    const inside = o > 0.02;
    for (const obj of [vFloor, wallMesh, colMesh, partMesh, mullMesh, louvreMesh, posts, boards, backs, cardMesh, trayMesh, labels, avatarMesh, shirtMesh, bulkMesh, ...Object.values(kitMeshes)]) obj.visible = inside || o > 0 || obj === vFloor ? inside : false;
    for (const mesh of Object.values(kitMeshes)) if (inside) mesh.visible = mesh.count > 0;
    return true;
  }

  // ---- picking ---------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function setRay(cx, cy) { const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function pick(cx, cy) {
    setRay(cx, cy);
    if (tower.target < 0.5) {
      const hit = ray.intersectObjects([storeyMesh, bandMesh, roofMesh, facadeMesh, verletBand], false)[0];
      return hit ? { type: "tower" } : null;
    }
    const targets = [cardMesh, trayMesh, avatarMesh, shirtMesh, ...Object.values(kitMeshes).filter((m) => m.visible), zoneMesh];
    for (const h of ray.intersectObjects(targets, false)) {
      const o = h.object;
      if (o === cardMesh || o === trayMesh) { const b = (o === cardMesh ? cardBins : trayBins)[h.instanceId]; if (b?.visible) return { type: "bin", id: b.id }; continue; }
      if (o === avatarMesh || o === shirtMesh) return { type: "person", id: o.userData.slots[h.instanceId] };
      if (o.userData.slots) return { type: "piece", id: o.userData.slots[h.instanceId] };
      if (o === zoneMesh) return { type: "building", id: B[h.instanceId].id };
    }
    return null;
  }

  // ---- pointer: pick, and drag furniture in edit mode ----------------------------------
  let down = null, edit = null, pendingMove = null, flight = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY }; flight = null;
    if (!edit) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit?.type !== "piece" || !edit.canMove(hit.id)) return;
    const pc = pieceById.get(hit.id), w = pieceWorld(pc);
    setRay(e.clientX, e.clientY);
    const p = ray.ray.intersectPlane(groundPlane, new THREE.Vector3());
    dragState = { id: hit.id, ox: p ? w.x - p.x : 0, oz: p ? w.z - p.z : 0, start: { x: pc.x, z: pc.z }, valid: true, moved: false };
    controls.enabled = false; canvas.setPointerCapture(e.pointerId);
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
      layoutPieces(); selectPiece(pc.id); down = null;
      return;
    }
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    hooks.onPick?.(pick(e.clientX, e.clientY));
  });
  canvas.addEventListener("pointerleave", () => { pendingMove = null; if (hover) { hover = null; repaint(); hooks.onHover?.(null); } });

  // ---- layout validation: stay in the zone, keep clear of columns, shelving, others --
  function footprint(pc) {
    const k = KIT[pc.kind], quarter = Math.round((((pc.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 2;
    const w = quarter ? k.d : k.w, d = quarter ? k.w : k.d;
    return { x0: pc.x - w / 2, x1: pc.x + w / 2, z0: pc.z - d / 2, z1: pc.z + d / 2 };
  }
  const overlap = (a, b) => a.x0 < b.x1 - 0.02 && a.x1 > b.x0 + 0.02 && a.z0 < b.z1 - 0.02 && a.z1 > b.z0 + 0.02;
  const OBST = [
    ...COLUMNS.map(([x, z]) => ({ x0: x - COLUMN / 2 - 0.05, x1: x + COLUMN / 2 + 0.05, z0: z - COLUMN / 2 - 0.05, z1: z + COLUMN / 2 + 0.05 })),
    ...Object.values(RACK).map((r) => { const [ax, az] = rackPoint(r, 0, -SH.depth / 2), [bx, bz] = rackPoint(r, r.len, SH.depth / 2 + 0.9); return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) }; }),
  ];
  function validPlacement(pc) {
    const d = deptOf.get(pc.dept), b = byB.get(d.building), f = footprint(pc);
    const hw = b.w / 2 - 0.1, hd = b.d / 2 - 0.1;
    if (f.x0 < -hw || f.x1 > hw || f.z0 < -hd || f.z1 > hd) return false;
    const wf = { x0: f.x0 + b.x, x1: f.x1 + b.x, z0: f.z0 + b.z, z1: f.z1 + b.z };
    if (wf.x0 < AREA.x0 + 0.25 || wf.z0 < AREA.z0 + 0.25 || wf.x1 > AREA.x1 - 0.1 || wf.z1 > AREA.z1 - 0.3) return false;
    if (OBST.some((o) => overlap(wf, o))) return false;
    return !pieces.some((o) => o.id !== pc.id && o.dept === pc.dept && overlap(f, footprint(o)));
  }
  function freeSpot(deptId, kind) {
    const b = byB.get(deptOf.get(deptId).building);
    const probe = { id: "_probe", dept: deptId, kind, x: 0, z: 0, rot: 0 };
    for (let r = 0; r < Math.max(b.w, b.d); r += 0.5) for (let a = 0; a < 24; a++) {
      probe.x = Math.round(Math.cos((a / 24) * Math.PI * 2) * r * 4) / 4; probe.z = Math.round(Math.sin((a / 24) * Math.PI * 2) * r * 4) / 4;
      if (validPlacement(probe)) return { x: probe.x, z: probe.z };
    }
    return null;
  }

  // ---- piece animation ------------------------------------------------------------------
  function anim(id) {
    let a = pieceAnim.get(id);
    if (!a) { const pc = pieceById.get(id); a = { lift: 0, vy: 0, liftTo: 0, rot: pc?.rot || 0, scale: 1, scaleTo: 1 }; pieceAnim.set(id, a); }
    return a;
  }
  function updatePieces(dt) {
    let moving = false;
    for (const [id, a] of pieceAnim) {
      const pc = pieceById.get(id);
      if (a.drop) { a.vy -= 22 * dt; a.lift += a.vy * dt; moving = true; if (a.lift <= a.liftTo) { a.lift = a.liftTo; if (Math.abs(a.vy) > 1.4) a.vy = -a.vy * 0.32; else { a.vy = 0; a.drop = false; } } }
      else { const nl = damp(a.lift, a.liftTo, 14, dt); if (Math.abs(nl - a.lift) > 0.0005) moving = true; a.lift = Math.abs(nl - a.liftTo) < 0.0005 ? a.liftTo : nl; }
      if (pc) { if (Math.abs(pc.rot - a.rot) > 0.001) { a.rot = damp(a.rot, pc.rot, 11, dt); moving = true; } else a.rot = pc.rot; }
      const ns = damp(a.scale, a.scaleTo, 11, dt);
      if (Math.abs(ns - a.scaleTo) > 0.002) { a.scale = ns; moving = true; } else a.scale = a.scaleTo;
      if (a.scaleTo === 0 && a.scale === 0) { pieceAnim.delete(id); a.done?.(); continue; }
      if (!a.drop && a.liftTo === 0 && a.lift === 0 && a.scale === 1 && a.scaleTo === 1 && pc && a.rot === pc.rot) pieceAnim.delete(id);
    }
    if (moving) layoutPieces();
    return moving;
  }

  // ---- cameras ----------------------------------------------------------------------------
  function flyTo(pos, target, ms = 1500, lift = null) {
    if (reduceMotion.matches) { camera.position.copy(pos); controls.target.copy(target); controls.update(); needsRender = true; return null; }
    const dist = camera.position.distanceTo(pos);
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), ms, lift: lift ?? (dist > 12 ? Math.min(14, dist * 0.2) : 0.3), ease: easeInOut };
    return flight;
  }
  const narrow = () => canvas.clientWidth < 700;
  const towerShot = () => (narrow() ? [new THREE.Vector3(PCX + 34, 30, PL.z1 + 92), new THREE.Vector3(PCX + 2, GROUND_Y - 4, PCZ + 10)] : [new THREE.Vector3(PCX + 58, 22, PL.z1 + 62), new THREE.Vector3(PCX + 12, GROUND_Y + 9, PCZ)]);
  const floorShot = () => (narrow() ? [new THREE.Vector3(4, 58, 46), new THREE.Vector3(2, -10, 14)] : [new THREE.Vector3(20, 34, 40), new THREE.Vector3(5, -1, 2)]);
  function zoneShot(id) {
    const b = byB.get(id), r = Math.max(b.w, b.d);
    if (narrow()) return [new THREE.Vector3(b.x + r * 0.2, r * 1.6 + 4, b.z + r * 1.2 + 4), new THREE.Vector3(b.x, -2, b.z + r * 0.35)];
    return [new THREE.Vector3(b.x + r * 0.45, r * 0.55 + 3.5, b.z + r * 0.62 + 3.5), new THREE.Vector3(b.x + b.w * 0.12, 0.3, b.z)];
  }
  function focusPoint(sel) {
    if (!sel) return null;
    if (sel.type === "bin") { const b = binById.get(sel.id); return b && new THREE.Vector3(b.x, b.y, b.z); }
    if (sel.type === "piece") { const pc = pieceById.get(sel.id); const w = pc && pieceWorld(pc); return w && new THREE.Vector3(w.x, 0.9, w.z); }
    if (sel.type === "person") { const p = people.find((x) => x.id === sel.id); const s = p && avatarSpot(p); return s && new THREE.Vector3(s.x, 1.1, s.z); }
    if (sel.type === "building") { const b = byB.get(sel.id); return b && new THREE.Vector3(b.x, 0.2, b.z); }
    if (sel.type === "tower") return new THREE.Vector3((AREA.x0 + AREA.x1) / 2, 0, PL.z1);
    return null;
  }
  function focus(sel) {
    const p = focusPoint(sel); if (!p) return;
    if (sel.type === "bin") {
      const b = binById.get(sel.id), n = b.front, side = [n[1], -n[0]];   // stand in front, a little off-axis
      const dist = narrow() ? 3.4 : 2.6, off = narrow() ? 0 : 0.6;
      flyTo(new THREE.Vector3(p.x + n[0] * dist + side[0] * -off, Math.max(1.4, p.y + 0.35), p.z + n[1] * dist + side[1] * -off), new THREE.Vector3(p.x + side[0] * -off * 0.7, p.y - (narrow() ? 0.8 : 0.05), p.z + side[1] * -off * 0.7));
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
    const b = w.b;
    outline.visible = true;
    outline.position.set(b.x + (f.x0 + f.x1) / 2, w.y + (h + 0.04) / 2, b.z + (f.z0 + f.z1) / 2);
    outline.scale.set(f.x1 - f.x0 + 0.08, h + 0.08, f.z1 - f.z0 + 0.08);
    outline.rotation.y = 0;
    outline.material.color.set(dragState && !dragState.valid ? "#ff5a4f" : "#ff5c95");
    needsRender = true;
  }

  // ---- routes: lifts → partition door → walkway → into the zone → to the thing ---------
  function target(sel) {
    if (sel.type === "bin") { const b = binById.get(sel.id); return [b.x + b.front[0] * 0.9, b.z + b.front[1] * 0.9]; }
    if (sel.type === "piece") { const pc = pieceById.get(sel.id), w = pc && pieceWorld(pc); if (!w) return null; const dd = KIT[pc.kind].d / 2 + 0.7; return [w.x + Math.sin(w.rot) * dd, w.z + Math.cos(w.rot) * dd]; }
    if (sel.type === "person") { const p = people.find((x) => x.id === sel.id); const s = p && avatarSpot(p); return s && [s.x + Math.sin(s.rot) * 0.8, s.z + Math.cos(s.rot) * 0.8]; }
    return null;
  }
  function showRoute(sel) {
    const t = target(sel); if (!t) { clearRoute(); return 0; }
    let pts = [[LIFTS.x, LIFTS.z + 1.6], [LIFTS.x, DOOR.z], [AREA.x1 + 1.2, DOOR.z], [AREA.x1 - 1.2, DOOR.z], [AREA.x1 - 2.2, WALKWAY_Z]];
    // along the walkway, dodging columns, then straight into the zone
    const cx = THREE.MathUtils.clamp(t[0], AREA.x0 + 1, AREA.x1 - 2.2);
    pts.push([cx + (cx > COLUMNS[0][0] ? 0 : 0), WALKWAY_Z], [t[0], WALKWAY_Z], [t[0], t[1]]);
    for (const [x, z] of COLUMNS) for (const p of pts) if (Math.abs(p[0] - x) < 0.5 && Math.abs(p[1] - z) < 0.5) p[0] += 0.8;
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.05);
    const geo = ribbon(chaikin(pts, 3), 0.5);
    route.geometry.dispose(); route.geometry = geo;
    routeLen = geo.userData.length;
    routeMat.uniforms.uReveal.value = reduceMotion.matches ? routeLen : 0;
    route.visible = true;
    ring.position.set(t[0], 0.03, t[1]); ring.visible = true;
    needsRender = true;
    return routeLen;
  }
  function clearRoute() { route.visible = false; ring.visible = false; needsRender = true; }
  function overRoute(sel) {
    const end = focusPoint(sel); if (!end) return;
    const sx = LIFTS.x, sz = LIFTS.z, cx = (end.x + sx) / 2, cz = (end.z + sz) / 2, span = Math.hypot(end.x - sx, end.z - sz);
    flyTo(new THREE.Vector3(cx + span * 0.15, 8 + span * (narrow() ? 1.3 : 0.8), cz + span * (narrow() ? 0.9 : 0.6) + 4), new THREE.Vector3(cx, narrow() ? -span * 0.15 : 0, cz + (narrow() ? span * 0.2 : 0)), 1500);
  }

  function drop(id, n, dir) {
    const b = binById.get(id); if (!b) return;
    n = Math.min(n, 8);
    const fx = b.front[0], fz = b.front[1];
    for (let i = 0; i < n; i++) {
      if (dir === "out") units.push({ p: new THREE.Vector3(b.x + fx * b.d / 2 + (Math.random() - 0.5) * 0.3 * fz, b.y + 0.1, b.z + fz * b.d / 2 + (Math.random() - 0.5) * 0.3 * fx), v: new THREE.Vector3(fx * (0.8 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.6, 1.4 + Math.random() * 0.8, fz * (0.8 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.6), r: new THREE.Euler(), w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), age: -i * 0.07, life: 2.2, mode: "out" });
      else units.push({ p: new THREE.Vector3(b.x + (Math.random() - 0.5) * 0.2, b.y + 1.2 + i * 0.12, b.z), v: new THREE.Vector3(0, -0.5, 0), r: new THREE.Euler(), w: new THREE.Vector3(Math.random() * 3, Math.random() * 3, 0), age: -i * 0.09, life: 3, mode: "in", floor: b.y + b.h / 2 - 0.06 });
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
    if (sel.type === "bin") p.y += binById.get(sel.id).h / 2 + 0.14;
    else if (sel.type === "piece") p.y += 1.1 + (pieceAnim.get(sel.id)?.lift || 0);
    else if (sel.type === "person") p.y += 0.7;
    else if (sel.type === "building") p.y += 0.4;
    else if (sel.type === "tower") p.y += FH + 0.2;
    p.project(camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * canvas.clientHeight };
  }

  // ---- loop ---------------------------------------------------------------------------------
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
    if (updateTower(dt)) dirty = true;
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
    if (route.visible) routeMat.uniforms.uReveal.value = damp(routeMat.uniforms.uReveal.value, routeLen + 1, 1.4, dt);
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
        const gy = u.mode === "in" ? u.floor : 0.04;
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

  const setTower = (target) => { tower.target = target; if (reduceMotion.matches) { tower.open = target; tower.vel = 0; } towerDirty = true; };
  fitShadow(PCX, GROUND_Y + 8, PCZ, 48);

  // ---- public api -----------------------------------------------------------------------------
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
      const [p, tg] = towerShot();
      if (reduceMotion.matches || lowPower) { camera.position.copy(p); controls.target.copy(tg); controls.update(); needsRender = true; return; }
      camera.position.set(p.x + 30, p.y + 50, p.z + 40); controls.target.copy(tg);
      const f = flyTo(p, tg, 4600, 0); if (f) f.ease = (k) => 1 - Math.pow(1 - k, 3);
    },
    assemble() { if (reduceMotion.matches || lowPower) return; tower.assemble = 0; tower.assembleT = 0; towerDirty = true; },
    peek() {},
    // outside the block
    campus(fly = true) { focusZone = null; setTower(0); repaint(); fitShadow(PCX, GROUND_Y + 8, PCZ, 48); if (fly) { const [p, tg] = towerShot(); flyTo(p, tg, 2000); } },
    // inside, the whole of Verlet's floor
    floor(fly = true) { focusZone = null; setTower(1); repaint(); fitShadow(0, 0, 0, 26); if (fly) { const [p, tg] = floorShot(); flyTo(p, tg, 2200); } },
    // inside, one department's zone
    enter(id, fly = true) {
      const b = byB.get(id); if (!b) return;
      const wasIn = tower.target > 0.5;
      setTower(1); focusZone = id; repaint();
      fitShadow(b.x, 0, b.z, Math.max(b.w, b.d) * 0.8 + 4);
      setTimeout(() => raiseCurtain(b, accents[id] || "#ff5c95"), wasIn ? 250 : 1200);
      if (fly) { const [p, tg] = zoneShot(id); flyTo(p, tg, wasIn ? 1700 : 2600); }
    },
    flyTo, overRoute, focus, select, showRoute, clearRoute, drop, setLabel, setBinVisible, project,
    setHeat(map) { heat = map; repaint(); },
    setEdit(opts) {
      edit = opts;
      if (opts) { const b = byB.get(deptOf.get(opts.deptId).building); grid.scale.set(b.w, b.d, 1); grid.position.set(b.x, 0.02, b.z); gridMat.uniforms.uSize.value.set(b.w, b.d); gridMat.uniforms.uT.value = 0; grid.visible = true; }
      else { grid.visible = false; dragState = null; controls.enabled = true; }
      needsRender = true;
    },
    validPlacement, freeSpot, selectPiece,
    dropIn(id) { const a = anim(id); a.lift = 3.0; a.vy = 0; a.drop = true; a.liftTo = 0; a.scale = 0.5; a.scaleTo = 1; needsRender = true; },
    shrinkOut(id, done) { const a = anim(id); a.scaleTo = 0; a.done = done; needsRender = true; },
  };
}

// ---- geometry helpers -------------------------------------------------------------------
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
function trayGeometry() {
  // open-top parts tray, origin at the bottom
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  g.translate(0, 0.5, 0);
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

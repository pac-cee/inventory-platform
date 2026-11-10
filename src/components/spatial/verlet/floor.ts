// Verlet's floor from the 3D floor site (mockup/, localhost:5190), rebuilt as a
// static room for the office map: the open hall from the walk-through video
// (yellow walls, 60 cm glossy tiles, columns on a 6 m grid, south glazing with
// a louvred band, frosted east partition with a glass door, pine wall shelving)
// with its desks and benches, inside the office block above the street.
//
// The whole 5190 floor plan is placed as it is there: every zone, desk,
// bench, column and the pine stockroom shelving.
//
// Everything here is static, so it is merged into one mesh per material:
// about a dozen draw calls for the whole building.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as T from "./textures.js";
import { kitGeometry } from "./kit.js";
import {
  AREA,
  CEILING,
  COLUMNS,
  PIECES,
  REPLACED,
  SHELVING,
} from "@/lib/spatial/verlet-site";

/** The hall's centre is the world origin; shelves, routes and Edit plan share it. */
export const HALL_OFFSET = new THREE.Vector3(0, 0, 0);
/** The hall's centre in world space, for framing and the sun. */
export const HALL_CENTER = HALL_OFFSET.clone();
export const HALL_HALF_WIDTH = 19.5;
export const SUN_DIRECTION = (() => {
  const az = THREE.MathUtils.degToRad(35),
    el = THREE.MathUtils.degToRad(38);
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  ).normalize();
})();
export const SKY = { top: "#4a6687", horizon: "#d9c8b4", ground: "#a99a8c" };

// ---- site, from mockup/src/site.js (hall coordinates, metres) ----------------
// The building is Umuyenzi Plaza, 42 KN 5 Rd, Remera, Kigali (Google Maps
// listing "Verlet Robotics Rwanda"; Street View Feb 2023): shops on the
// ground floor, three floors above, Verlet on the 2nd. The outline is still
// the estimated floor plate; the facade follows the photos.
const FH = 3.8;
const BELOW = 2;
const GROUND_Y = -BELOW * FH;
const PL = { x0: -18.5, x1: 42.5, z0: -12.5, z1: 12.5 };
const PW = PL.x1 - PL.x0,
  PD = PL.z1 - PL.z0,
  PCX = (PL.x0 + PL.x1) / 2,
  PCZ = (PL.z0 + PL.z1) / 2;
const DOOR = { z: -1.5, w: 2.0 };
const LIFTS = { x: 31, z: -1.5 };
const STREET = { z: 24, width: 10 };
/** Leafy trees behind and beside the block; the street side has palms. */
const TREES = [[-28, 4], [52, 2], [-28, -14], [52, -14], [-10, -24], [20, -25]];

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Uniforms for the see-through cut: anything within uCutR of the line from
 *  the camera (A) to what it is looking at (B) is not drawn. */
type Cut = Record<"uCutOn" | "uCutA" | "uCutB" | "uCutR", THREE.IUniform>;
/** Per-vertex metalness/roughness, so one material serves wood, paint and aluminium. */
function surfaceShader(material: THREE.MeshStandardMaterial, key: string, cut: Cut) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cut);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 surface;\nvarying vec2 vSurface;\nvarying vec3 vCutPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurface = surface;\nvCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vSurface;\nvarying vec3 vCutPos;\nuniform float uCutOn;\nuniform vec3 uCutA;\nuniform vec3 uCutB;\nuniform float uCutR;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (uCutOn > 0.5) {
          vec3 ab = uCutB - uCutA;
          float t = clamp(dot(vCutPos - uCutA, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
          if (t < 0.85 && distance(vCutPos, uCutA + ab * t) < uCutR) discard;
        }`,
      )
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= vSurface.x;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= vSurface.y;");
  };
  material.customProgramCacheKey = () => key;
  return material;
}
/** World-space UVs, so a texture keeps its true scale on any wall or floor. */
function worldUV(material: THREE.MeshStandardMaterial, mode: "floor" | "wall", tile: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = { value: tile };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTile;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        vec4 wuv = modelMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * normal);
        vec2 tuv = ${mode === "wall" ? "(abs(wn.x) > 0.5 ? vec2(wuv.z, wuv.y) : abs(wn.y) > 0.5 ? wuv.xz : vec2(wuv.x, wuv.y)) * uTile" : "wuv.xz * uTile"};
        #ifdef USE_MAP
          vMapUv = tuv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = tuv;
        #endif`,
      );
  };
  material.customProgramCacheKey = () => `wuv-${mode}-${tile}`;
  return material;
}

/** A sky to sit behind everything: gradient with a soft sun glow, as an equirect map. */
export function skyTexture() {
  // A soft gradient: a small map looks the same and draws 4× faster at start-up.
  const W = 256, H = 128;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const top = new THREE.Color(SKY.top), hz = new THREE.Color(SKY.horizon), gr = new THREE.Color(SKY.ground);
  const c = new THREE.Color(), dir = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W - 0.5) * Math.PI * 2;
      dir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      const h = dir.y;
      if (h > 0) c.copy(hz).lerp(top, Math.pow(h, 0.5));
      else c.copy(hz).lerp(gr, Math.pow(-h, 0.4));
      const s = Math.max(dir.dot(SUN_DIRECTION), 0);
      const glow = Math.pow(s, 80) + Math.pow(s, 6) * 0.12;
      c.r += glow;
      c.g += glow * 0.85;
      c.b += glow * 0.65;
      // THREE.Color works in linear space; the canvas holds sRGB.
      c.convertLinearToSRGB();
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, c.r * 255);
      img.data[i + 1] = Math.min(255, c.g * 255);
      img.data[i + 2] = Math.min(255, c.b * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createVerletFloor() {
  const group = new THREE.Group();
  group.name = "verlet-floor";
  group.position.copy(HALL_OFFSET);

  // ---- geometry helpers ---------------------------------------------------------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  /** Non-indexed copy of `g`, moved into place (rotation about y, optional tilt x). */
  function placed(
    g: THREE.BufferGeometry,
    x: number, y: number, z: number,
    ry = 0, sx = 1, sy = 1, sz = 1, rx = 0,
  ) {
    const out = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    q.setFromEuler(e.set(rx, ry, 0, "YXZ"));
    out.applyMatrix4(m4.compose(p3.set(x, y, z), q, s3.set(sx, sy, sz)));
    return out;
  }
  /** Paint a placed geometry for the shared vertex-colour material. */
  function paint(g: THREE.BufferGeometry, color: string, metal = 0, rough = 0.85) {
    const n = g.attributes.position.count;
    if (!g.attributes.color) {
      const c = new THREE.Color(color), a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    }
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const s = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) s.set([metal, rough], i * 2);
    g.setAttribute("surface", new THREE.BufferAttribute(s, 2));
    for (const name of Object.keys(g.attributes))
      if (!["position", "normal", "uv", "color", "surface"].includes(name)) g.deleteAttribute(name);
    return g;
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) =>
    placed(new THREE.BoxGeometry(w, h, d), x, y, z, ry);
  const plane = (w: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    return placed(g, x, y, z);
  };
  const meshes: THREE.Mesh[] = [];
  function bake(
    parts: THREE.BufferGeometry[],
    material: THREE.Material,
    cast = true,
    receive = true,
  ) {
    const geometry = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  // ---- materials --------------------------------------------------------------
  const tile = T.tiles();
  const tileMat = worldUV(new THREE.MeshStandardMaterial({ map: tile.map, roughnessMap: tile.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 1.3 }), "floor", 1 / 0.6);
  const greyMat = worldUV(new THREE.MeshStandardMaterial({ map: tile.map, roughness: 0.5, color: "#9d9a95" }), "floor", 1 / 0.6);
  const grassMat = worldUV(new THREE.MeshStandardMaterial({ map: T.grass(), roughness: 0.95 }), "floor", 0.09);
  const curtainMat = worldUV(new THREE.MeshStandardMaterial({ map: T.curtainWall(), metalness: 0.55, roughness: 0.12, envMapIntensity: 1.6 }), "wall", 1 / 1.5);
  const cut: Cut = {
    uCutOn: { value: 0 },
    uCutA: { value: new THREE.Vector3() },
    uCutB: { value: new THREE.Vector3() },
    uCutR: { value: 1.1 },
  };
  const paintMat = surfaceShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 }), "verlet-paint", cut);
  const clearGlass = new THREE.MeshStandardMaterial({ color: "#a9c4d4", transparent: true, opacity: 0.28, metalness: 0.2, roughness: 0.05, envMapIntensity: 1.6, depthWrite: false });
  const frostMat = new THREE.MeshStandardMaterial({ map: T.frosted(), transparent: true, roughness: 0.5, depthWrite: false });
  const cardMat = new THREE.MeshStandardMaterial({ map: T.cardboard(), roughness: 0.92 });
  const trayMat = new THREE.MeshStandardMaterial({ color: "#f1f1ee", roughness: 0.5, side: THREE.DoubleSide });
  const pinkMat = new THREE.MeshStandardMaterial({ color: "#ff5c95", emissive: "#ff5c95", emissiveIntensity: 0.35, roughness: 0.5 });

  const painted: THREE.BufferGeometry[] = [];
  const P = (g: THREE.BufferGeometry, color: string, metal = 0, rough = 0.85) =>
    painted.push(paint(g, color, metal, rough));
  const ALUM = "#d4d8dc";

  // ---- street level -------------------------------------------------------------
  {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), grassMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(PCX, GROUND_Y - 0.02, PCZ);
    ground.receiveShadow = true;
    group.add(ground);
    const road = { x0: PL.x0 - 40, x1: PL.x1 + 40, z0: PL.z0 - 20, z1: STREET.z + 12 };
    const street = new THREE.Mesh(
      new THREE.PlaneGeometry(road.x1 - road.x0, road.z1 - road.z0),
      new THREE.MeshStandardMaterial({ map: T.streetDecals(road, PL, STREET), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    street.rotation.x = -Math.PI / 2;
    street.position.set((road.x0 + road.x1) / 2, GROUND_Y - 0.005, (road.z0 + road.z1) / 2);
    street.receiveShadow = true;
    group.add(street);
    TREES.forEach(([x, z], i) => {
      const s = 0.85 + hash(i + 3) * 0.5, ry = hash(i) * 6;
      P(placed(new THREE.CylinderGeometry(0.14, 0.22, 2.6, 8), x, GROUND_Y + 1.3 * s, z, 0, s, s, s), "#5a4636");
      for (const [dx, dy, dz, r, c] of [
        [0, 2.6, 0, 1.9, "#3f6e33"], [0.9, 3.3, 0.3, 1.4, "#4f8040"],
        [-0.8, 3.5, -0.4, 1.3, "#456f37"], [0.1, 4.1, 0.1, 1.1, "#5a8a46"],
      ] as const) {
        const ox = dx * Math.cos(ry) + dz * Math.sin(ry), oz = -dx * Math.sin(ry) + dz * Math.cos(ry);
        P(placed(new THREE.IcosahedronGeometry(r * s, 1), x + ox * s, GROUND_Y + (2.2 + dy) * s, z + oz * s), c);
      }
    });
    const carColors = ["#d7d7d4", "#2c3e57", "#8a1c1c", "#1d1f22"];
    ([[-6, 1], [14, -1], [26, 1], [44, -1]] as const).forEach(([x, side], i) => {
      const ry = Math.PI / 2 + (side > 0 ? Math.PI : 0), cz = STREET.z + side * 2.2;
      const at = (lx: number, ly: number, lz: number) => [x + lx * Math.cos(ry) + lz * Math.sin(ry), GROUND_Y + ly, cz - lx * Math.sin(ry) + lz * Math.cos(ry)] as const;
      const [bx, by, bz] = at(0, 0.59, 0);
      P(box(1.8, 0.62, 4.3, bx, by, bz, ry), carColors[i], 0.3, 0.35);
      const [tx, ty, tz] = at(0, 1.15, -0.2);
      P(box(1.6, 0.5, 2.2, tx, ty, tz, ry), "#20262e", 0.2, 0.2);
      for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
        const [cx, cy, czz] = at(wx, 0.33, wz);
        const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14);
        wheel.rotateZ(Math.PI / 2);
        P(placed(wheel, cx, cy, czz, ry), "#141414");
      }
    });
  }

  // ---- KN 5 Rd: a dual carriageway with a planted median, palms either side ------
  const SB = { x0: PL.x0 - 40, x1: PL.x1 + 40 };
  P(box(SB.x1 - SB.x0, 0.18, 1.6, (SB.x0 + SB.x1) / 2, GROUND_Y + 0.09, STREET.z), "#a3a09a");
  P(box(SB.x1 - SB.x0, 0.03, 1.3, (SB.x0 + SB.x1) / 2, GROUND_Y + 0.195, STREET.z), "#5f8240");
  /** A royal palm: a tall pale trunk and a crown of drooping fronds. */
  function palm(x: number, z: number, i: number) {
    const s = 0.85 + hash(i + 17) * 0.35, h = 7.5 * s, lean = (hash(i + 5) - 0.5) * 0.08;
    P(placed(new THREE.CylinderGeometry(0.15, 0.24, h, 8), x, GROUND_Y + h / 2, z, 0, 1, 1, 1, lean), "#9b8f7b");
    P(placed(new THREE.CylinderGeometry(0.2, 0.17, 1.1, 8), x, GROUND_Y + h + 0.3, z), "#6f8a4a");
    for (let f = 0; f < 9; f++) {
      const yaw = f * 0.698 + hash(i + f) * 0.4, droop = 0.25 + hash(i * 3 + f) * 0.45, r = 1.7 * s;
      const cx = Math.sin(yaw) * Math.cos(droop) * r, cy = -Math.sin(droop) * r, cz = Math.cos(yaw) * Math.cos(droop) * r;
      P(placed(new THREE.SphereGeometry(1, 8, 6), x + cx, GROUND_Y + h + 0.8 + cy * 0.6, z + cz, yaw, 0.32 * s, 0.05 * s, 1.9 * s, droop), f % 2 ? "#4f7a35" : "#5f8d3f");
    }
  }
  let palms = 0;
  for (let x = SB.x0 + 5; x < SB.x1 - 4; x += 9) palm(x, STREET.z, palms++);
  for (let x = PL.x0 - 6; x < PL.x1 + 8; x += 10) palm(x + 2, 17.6, palms++);

  // ---- the block: Umuyenzi Plaza --------------------------------------------------
  // Ground-floor shops under a long green canopy; above them ochre-rendered
  // wings with balconies either side of a bowed glass curtain wall. The floors
  // above Verlet's are left off so the floor stays visible.
  const OCHRE = "#cfa65e", OCHRE_DARK = "#b48a46", SLAB = "#dcd8cf", RAIL = "#8f969c";
  const GLASS = { x0: 4, x1: 26 };
  /** How far the curved glass centre bows out towards the street. */
  const bow = (x: number) => {
    const t = (x - GLASS.x0) / (GLASS.x1 - GLASS.x0);
    return t > 0 && t < 1 ? Math.sin(t * Math.PI) * 1.4 : 0;
  };
  const curtain: THREE.BufferGeometry[] = [];
  /** Window bands with piers on a rendered face. */
  function windows(x0: number, x1: number, z: number, y0: number, alongZ = false) {
    for (let t = x0 + 0.5; t + 2.2 <= x1 - 0.3; t += 3) {
      curtain.push(alongZ ? box(0.06, 1.7, 2.2, z, y0 + 1.75, t + 1.1) : box(2.2, 1.7, 0.06, t + 1.1, y0 + 1.75, z));
    }
  }
  /** A balcony at floor level: slab, steel rails and end posts. */
  function balcony(cx: number, y0: number) {
    const z = PL.z1 + 0.6;
    P(box(2.6, 0.12, 1.2, cx, y0 + 0.06, z), SLAB);
    for (const yy of [0.45, 0.75, 1.05]) P(box(2.6, 0.04, 0.04, cx, y0 + yy, z + 0.58), RAIL, 0.6, 0.4);
    for (const dx of [-1.28, 1.28]) {
      P(box(0.04, 0.04, 1.2, cx + dx, y0 + 1.05, z), RAIL, 0.6, 0.4);
      P(box(0.05, 1.05, 0.05, cx + dx, y0 + 0.55, z + 0.58), RAIL, 0.6, 0.4);
    }
  }
  /** The street face of one upper floor: wings, bowed glass and balconies. */
  function streetFace(y0: number, h: number, withBalconies: boolean) {
    for (const [a, b] of [[PL.x0, GLASS.x0], [GLASS.x1, PL.x1]]) {
      P(box(b - a, h, 0.3, (a + b) / 2, y0 + h / 2, PL.z1 - 0.15), OCHRE);
      if (h > 2) windows(a, b, PL.z1 + 0.02, y0);
      if (withBalconies) for (let x = a + 3.5; x < b - 2; x += 6) balcony(x, y0);
    }
    // the bowed glass centre, in 1.5 m panels following the curve
    for (let x = GLASS.x0; x < GLASS.x1 - 0.01; x += 1.5) {
      const za = PL.z1 + bow(x), zb = PL.z1 + bow(x + 1.5);
      curtain.push(box(1.52, h, 0.08, x + 0.75, y0 + h / 2, (za + zb) / 2, -Math.atan2(zb - za, 1.5)));
    }
  }
  for (let k = -BELOW; k <= 0; k++) P(box(PW + 0.4, 0.4, PD + 0.4, PCX, k * FH - 0.2, PCZ), SLAB);
  for (let k = -BELOW; k < 0; k++) {
    const y0 = k * FH, h = FH - 0.4;
    // rendered west, east and north faces with window bands
    P(box(0.3, h, PD, PL.x0 + 0.15, y0 + h / 2, PCZ), OCHRE);
    P(box(0.3, h, PD, PL.x1 - 0.15, y0 + h / 2, PCZ), OCHRE);
    P(box(PW, h, 0.3, PCX, y0 + h / 2, PL.z0 + 0.15), OCHRE);
    windows(PL.z0, PL.z1, PL.x0 - 0.02, y0, true);
    windows(PL.z0, PL.z1, PL.x1 + 0.02, y0, true);
    windows(PL.x0, PL.x1, PL.z0 - 0.02, y0);
    if (k === -BELOW) {
      // shopfronts between piers, under a long green canopy with sign panels
      for (let x = PL.x0; x <= PL.x1 + 0.01; x += 4) P(box(0.45, h, 0.45, x, y0 + h / 2, PL.z1 - 0.1), OCHRE_DARK);
      for (let x = PL.x0 + 0.25; x < PL.x1 - 0.2; x += 4) curtain.push(box(3.5, 2.9, 0.08, x + 1.75, y0 + 1.45, PL.z1 - 0.3));
      P(box(PW + 1, 0.16, 2.6, PCX, y0 + 3.1, PL.z1 + 1.3), "#2f5a3c");
      P(box(PW + 1, 0.42, 0.08, PCX, y0 + 3.3, PL.z1 + 2.6), "#24482f");
      const signs = ["#1f6f8b", "#ece7da", "#7a2531", "#2b4f8a", "#e2b33c", "#ece7da"];
      for (let i = 0; i < 10; i++) P(box(3.2, 0.5, 0.06, PL.x0 + 3 + i * 6, y0 + 3.25, PL.z1 + 2.66), signs[i % signs.length]);
      for (let x = PL.x0 + 2; x < PL.x1; x += 8) P(box(0.1, 3.0, 0.1, x, y0 + 1.5, PL.z1 + 2.45), "#3a3d40", 0.5, 0.4);
    } else streetFace(y0, h, true);
  }
  // Verlet's floor: rendered at full height on the far sides, the street and
  // east faces at sill height so the floor stays visible from the usual views.
  P(box(0.3, FH - 0.4, PD, PL.x0 + 0.15, (FH - 0.4) / 2, PCZ), OCHRE);
  P(box(PW, FH - 0.4, 0.3, PCX, (FH - 0.4) / 2, PL.z0 + 0.15), OCHRE);
  P(box(0.3, 1.0, PD, PL.x1 - 0.15, 0.5, PCZ), OCHRE);
  streetFace(0, 1.0, true);
  bake(curtain, curtainMat, false, false);
  bake([box(AREA.x1 - AREA.x0 + 0.4, 0.22, 0.3, (AREA.x0 + AREA.x1) / 2, -0.06, PL.z1 + 0.05)], pinkMat, false, false);

  // ---- floors: Verlet's tiles, the rest of the floor grey --------------------------
  bake([plane(AREA.x1 - AREA.x0, AREA.z1 - AREA.z0, 0, 0.002, 0)], tileMat, false);
  bake([plane(PL.x1 - AREA.x1, PD, (AREA.x1 + PL.x1) / 2, 0.001, PCZ), plane(PW, PD, PCX, -0.001, PCZ)], greyMat, false);

  // ---- the hall: yellow walls (N, W) with a green bulkhead, columns, glazing --------
  const WT = 0.2;
  P(box(AREA.x1 - AREA.x0, CEILING, WT, 0, CEILING / 2, AREA.z0 + WT / 2), "#e9c62b");
  P(box(WT, CEILING, AREA.z1 - AREA.z0, AREA.x0 + WT / 2, CEILING / 2, 0), "#e9c62b");
  P(box(AREA.x1 - AREA.x0, 0.5, 0.02, 0, CEILING - 0.25, AREA.z0 + WT + 0.01), "#a9b98a");
  P(box(0.02, 0.5, AREA.z1 - AREA.z0, AREA.x0 + WT + 0.01, CEILING - 0.25, 0), "#a9b98a");
  // a dark cap on the cut walls, like an architectural section
  P(box(AREA.x1 - AREA.x0, 0.03, WT + 0.01, 0, CEILING + 0.015, AREA.z0 + WT / 2), "#3c4641");
  P(box(WT + 0.01, 0.03, AREA.z1 - AREA.z0, AREA.x0 + WT / 2, CEILING + 0.015, 0), "#3c4641");
  for (const [x, z] of COLUMNS) P(box(0.5, CEILING, 0.5, x, CEILING / 2, z), "#8fb0bd");
  for (let x = AREA.x0 + 0.75; x < AREA.x1; x += 1.5)
    for (let k = 0; k < 6; k++)
      P(box(1.42, 0.03, 0.06, x, CEILING - 0.08 - k * 0.07, AREA.z1 - 0.12), "#e9ebec", 0, 0.6);
  P(box(AREA.x1 - AREA.x0, 0.1, 0.12, 0, 0.05, AREA.z1 - 0.15), ALUM, 0.7, 0.35);
  // east: frosted partition with aluminium mullions and a glass double door
  const frost: THREE.BufferGeometry[] = [];
  for (let z = AREA.z0 + 0.6; z < AREA.z1; z += 1.2)
    if (Math.abs(z - DOOR.z) >= DOOR.w / 2 + 0.05) frost.push(box(0.03, CEILING, 1.18, AREA.x1, CEILING / 2, z));
  for (let z = AREA.z0; z <= AREA.z1 + 0.01; z += 1.2) P(box(0.06, CEILING, 0.05, AREA.x1, CEILING / 2, z), ALUM, 0.7, 0.35);
  P(box(0.08, 0.05, AREA.z1 - AREA.z0, AREA.x1, CEILING - 0.02, 0), ALUM, 0.7, 0.35);
  // the rest of the floor: lift core, lift doors, a frosted office row
  P(box(6, CEILING, 5, LIFTS.x + 1, CEILING / 2, LIFTS.z - 4.2), "#c7c2ba", 0, 0.9);
  P(box(1.0, 2.2, 0.05, LIFTS.x - 0.6, 1.1, LIFTS.z - 1.68), ALUM, 0.7, 0.35);
  P(box(1.0, 2.2, 0.05, LIFTS.x + 2.0, 1.1, LIFTS.z - 1.68), ALUM, 0.7, 0.35);
  for (let x = AREA.x1 + 3; x < PL.x1 - 1; x += 1.2) frost.push(box(1.18, CEILING, 0.03, x, CEILING / 2, 6));
  bake(frost, frostMat, false);
  bake([
    box(0.04, 2.2, DOOR.w / 2 - 0.04, AREA.x1, 1.1, DOOR.z - DOOR.w / 4),
    box(0.04, 2.2, DOOR.w / 2 - 0.04, AREA.x1, 1.1, DOOR.z + DOOR.w / 4),
  ], clearGlass, false);

  // ---- stockroom shelving: pine units in an L along the yellow walls, with boxes ---
  const SH = SHELVING;
  const cards: THREE.BufferGeometry[] = [], trays: THREE.BufferGeometry[] = [], tags: THREE.BufferGeometry[] = [];
  const bins: { code: string; x: number; y: number; z: number; h: number; d: number; rot: number; front: [number, number]; tray: boolean }[] = [];
  // Racks that an inventory location stands on are drawn by the office map.
  for (const r of SH.racks.filter((rack) => !REPLACED.has(rack.id))) {
    const along: [number, number] = r.dir === "east" ? [1, 0] : [0, 1];
    const front: [number, number] = r.dir === "east" ? [0, 1] : [1, 0];
    const at = (u: number, v: number) => [r.x + along[0] * u + front[0] * v, r.z + along[1] * u + front[1] * v];
    const rot = r.dir === "east" ? 0 : Math.PI / 2;
    for (let k = 0; k <= SH.bays; k++)
      for (const v of [-SH.depth / 2, SH.depth / 2]) {
        const [x, z] = at(k * SH.bayW, v);
        P(box(0.05, SH.height, 0.05, x, SH.height / 2, z, rot), "#d9b07a", 0, 0.7);
      }
    for (let k = 0; k < SH.bays; k++) {
      const [bx, bz] = at((k + 0.5) * SH.bayW, -SH.depth / 2 + 0.01);
      P(box(SH.bayW, SH.height, 0.015, bx, SH.height / 2, bz, rot), "#c69a62", 0, 0.75);
      for (const y of [...SH.levels, SH.height - 0.04]) {
        const [x, z] = at((k + 0.5) * SH.bayW, 0);
        P(box(SH.bayW - 0.04, 0.03, SH.depth, x, y, z, rot), "#d9b07a", 0, 0.7);
      }
      for (let l = 1; l <= SH.levels.length; l++)
        for (const sd of ["L", "R"]) {
          const i = bins.length, tray = hash(i) < 0.28;
          const h = tray ? 0.16 : 0.26 + hash(i + 7) * 0.2, w = tray ? 0.44 : 0.4 + hash(i + 3) * 0.06, d = tray ? 0.38 : 0.36;
          const u = (k + 0.5) * SH.bayW + (sd === "L" ? -0.25 : 0.25) + (hash(i + 5) - 0.5) * 0.03;
          const [x, z] = at(u, (hash(i + 9) - 0.5) * 0.03 + 0.02);
          const brot = rot + (hash(i + 11) - 0.5) * 0.06;
          const y = SH.levels[l - 1] + 0.015 + h / 2;
          bins.push({ code: `${r.name}-${k + 1}-${l}-${sd}`, x, y, z, h, d, rot: brot, front, tray });
          if (tray) {
            const g = new THREE.BoxGeometry(w, h, d);
            const index = Array.from(g.index!.array);
            const top = g.groups[2];
            index.splice(top.start, top.count);
            g.setIndex(index);
            g.clearGroups();
            trays.push(placed(g, x, y, z, brot));
          } else cards.push(placed(new THREE.BoxGeometry(w, h, d), x, y, z, brot));
        }
    }
  }
  bake(cards, cardMat, true);
  bake(trays, trayMat, false);
  const atlas = new T.LabelAtlas(bins.length);
  bins.forEach((b, i) => {
    atlas.draw(i, { code: b.code, line: "", qty: "" });
    const g = new THREE.PlaneGeometry(0.24, 0.12);
    const [cx, cy] = atlas.cellUV(i) as [number, number];
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) + cx) / atlas.N, (uv.getY(k) + cy) / atlas.N);
    const off = b.d / 2 + 0.004;
    tags.push(placed(g, b.x + b.front[0] * off, b.tray ? b.y - b.h * 0.05 : b.y - b.h * 0.12, b.z + b.front[1] * off, b.rot));
  });
  bake(tags, new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 }), false);

  // ---- furniture: the 5190 floor plan ---------------------------------------------
  // Pieces that stand for an inventory location are drawn by the office map.
  for (const p of PIECES)
    if (!REPLACED.has(p.id))
      P(placed(kitGeometry(p.kind).clone(), p.x, 0, p.z, p.rot), "#ffffff", 0.05, 0.62);

  bake(painted, paintMat, true);

  return {
    group,
    /** Cut away the hall's furniture between `from` and `to`; null turns it off. */
    cutaway(from: THREE.Vector3 | null, to?: THREE.Vector3) {
      cut.uCutOn.value = from && to ? 1 : 0;
      if (from && to) {
        (cut.uCutA.value as THREE.Vector3).copy(from);
        (cut.uCutB.value as THREE.Vector3).copy(to);
      }
    },
    dispose() {
      const textures = new Set<THREE.Texture>();
      const materials = new Set<THREE.Material>();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const m = object.material as THREE.MeshStandardMaterial;
          materials.add(m);
          for (const t of [m.map, m.roughnessMap]) if (t) textures.add(t);
        }
      });
      textures.forEach((t) => t.dispose());
      materials.forEach((m) => m.dispose());
      group.removeFromParent();
    },
  };
}

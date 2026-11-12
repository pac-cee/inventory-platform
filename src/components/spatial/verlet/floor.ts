// Verlet's floor from the 3D floor site (mockup/, localhost:5190), rebuilt as a
// static room for the office map: the open hall from the walk-through video
// (yellow walls, 60 cm glossy tiles, columns on a 6 m grid, south glazing with
// a louvred band, frosted east partition with a glass door, pine wall shelving)
// with its desks and benches, shown on its own as a cut-out floor model.
//
// The room follows the live floor plan (lib/spatial/verlet-site): its size,
// columns, door and small offices. Furniture is drawn by the office map.
//
// Everything here is static, so it is merged into one mesh per material:
// about a dozen draw calls for the whole floor.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as T from "./textures.js";
import {
  AREA,
  CEILING,
  DOOR,
  OFFICES,
  COLUMNS,
} from "@/lib/spatial/verlet-site";

/** The hall's centre is the world origin; shelves, routes and Edit plan share it. */
export const HALL_OFFSET = new THREE.Vector3(0, 0, 0);
/** The hall's centre in world space, for framing and the sun. */
export const HALL_CENTER = new THREE.Vector3(0, 0, -4);
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
/** A plain studio backdrop, so the floor model is the only thing to look at. */
export const SKY = { top: "#5b6066", horizon: "#b9b3aa", ground: "#4a4845" };

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
      const glow = Math.pow(s, 6) * 0.05;
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

  const painted: THREE.BufferGeometry[] = [];
  const P = (g: THREE.BufferGeometry, color: string, metal = 0, rough = 0.85) =>
    painted.push(paint(g, color, metal, rough));
  const ALUM = "#d4d8dc", SLAB = "#dcd8cf", WT = 0.2;

  // ---- the floor on its own, as an architectural model ------------------------------
  // Only Verlet's floor (hall, corridor and offices) is drawn, standing on its
  // slab like a cut-out model: no street, no block, no other tenants.
  const D0 = OFFICES.z0, D1 = AREA.z1, DCZ = (D0 + D1) / 2, W = AREA.x1 - AREA.x0, D = D1 - D0;
  P(box(W + 0.6, 0.34, D + 0.6, 0, -0.17, DCZ), SLAB, 0, 0.9);
  P(box(W + 0.62, 0.05, D + 0.62, 0, -0.36, DCZ), "#3c4641");
  bake([plane(W, D, 0, 0.002, DCZ)], tileMat, false);
  // the outside wall behind the offices, with a window in each office
  const NZ = D0, WALL = "#f1efe8";
  P(box(W, 0.9, WT, 0, 0.45, NZ + WT / 2), WALL);
  P(box(W, CEILING - 2.6, WT, 0, (CEILING + 2.6) / 2, NZ + WT / 2), WALL);
  P(box(W, 0.03, WT + 0.01, 0, CEILING + 0.015, NZ + WT / 2), "#3c4641");
  const panes: THREE.BufferGeometry[] = [];
  OFFICES.rooms.slice(0, -1).forEach((x0, i) => {
    const x1 = OFFICES.rooms[i + 1];
    for (let x = x0; x < x1 - 0.01; x += 1.5) {
      P(box(0.08, 1.7, WT + 0.02, x, 1.75, NZ + WT / 2), ALUM, 0.7, 0.35);
      panes.push(box(1.44, 1.7, 0.04, x + 0.75, 1.75, NZ + WT / 2));
    }
  });
  bake(panes, curtainMat, false, false);

  // ---- the hall: yellow walls (N, W) with a green bulkhead, columns, glazing --------
  const DOOR_H = 2.3;
  const doorL = DOOR.x - DOOR.w / 2, doorR = DOOR.x + DOOR.w / 2;
  // north wall, with the glass double door into the corridor
  P(box(doorL - AREA.x0, CEILING, WT, (AREA.x0 + doorL) / 2, CEILING / 2, AREA.z0 + WT / 2), "#e9c62b");
  P(box(AREA.x1 - doorR, CEILING, WT, (doorR + AREA.x1) / 2, CEILING / 2, AREA.z0 + WT / 2), "#e9c62b");
  P(box(DOOR.w, CEILING - DOOR_H, WT, DOOR.x, (CEILING + DOOR_H) / 2, AREA.z0 + WT / 2), "#e9c62b");
  for (const x of [doorL, doorR]) P(box(0.06, DOOR_H, WT + 0.04, x, DOOR_H / 2, AREA.z0 + WT / 2), ALUM, 0.7, 0.35);
  P(box(DOOR.w + 0.06, 0.06, WT + 0.04, DOOR.x, DOOR_H, AREA.z0 + WT / 2), ALUM, 0.7, 0.35);
  P(box(WT, CEILING, AREA.z1 - AREA.z0, AREA.x0 + WT / 2, CEILING / 2, 0), "#e9c62b");
  P(box(AREA.x1 - AREA.x0, 0.5, 0.02, 0, CEILING - 0.25, AREA.z0 + WT + 0.01), "#a9b98a");
  P(box(0.02, 0.5, AREA.z1 - AREA.z0, AREA.x0 + WT + 0.01, CEILING - 0.25, 0), "#a9b98a");
  // a dark cap on the cut walls, like an architectural section
  P(box(AREA.x1 - AREA.x0, 0.03, WT + 0.01, 0, CEILING + 0.015, AREA.z0 + WT / 2), "#3c4641");
  P(box(WT + 0.01, 0.03, AREA.z1 - OFFICES.z0, AREA.x0 + WT / 2, CEILING + 0.015, (AREA.z1 + OFFICES.z0) / 2), "#3c4641");
  for (const [x, z] of COLUMNS) P(box(0.5, CEILING, 0.5, x, CEILING / 2, z), "#8fb0bd");
  // south glazing: louvred top band and an aluminium sill
  for (let x = AREA.x0 + 0.75; x < AREA.x1; x += 1.5)
    for (let k = 0; k < 6; k++)
      P(box(1.42, 0.03, 0.06, x, CEILING - 0.08 - k * 0.07, AREA.z1 - 0.12), "#e9ebec", 0, 0.6);
  P(box(AREA.x1 - AREA.x0, 0.1, 0.12, 0, 0.05, AREA.z1 - 0.15), ALUM, 0.7, 0.35);
  // east: frosted partition with aluminium mullions, now closed (the door is north)
  const frost: THREE.BufferGeometry[] = [];
  for (let z = OFFICES.z0 + 0.6; z < AREA.z1; z += 1.2) frost.push(box(0.03, CEILING, 1.18, AREA.x1, CEILING / 2, z));
  for (let z = OFFICES.z0; z <= AREA.z1 + 0.01; z += 1.2) P(box(0.06, CEILING, 0.05, AREA.x1, CEILING / 2, z), ALUM, 0.7, 0.35);
  P(box(0.08, 0.05, AREA.z1 - OFFICES.z0, AREA.x1, CEILING - 0.02, (AREA.z1 + OFFICES.z0) / 2), ALUM, 0.7, 0.35);

  // ---- through the door: a corridor and four small offices -------------------------
  const front = OFFICES.z1 - OFFICES.corridor;
  const roomDepth = front - OFFICES.z0;
  P(box(WT, CEILING, OFFICES.z1 - OFFICES.z0, AREA.x0 + WT / 2, CEILING / 2, (OFFICES.z0 + OFFICES.z1) / 2), "#f1efe8");
  OFFICES.rooms.slice(1, -1).forEach((x) => {
    P(box(0.12, CEILING, roomDepth, x, CEILING / 2, (OFFICES.z0 + front) / 2), "#f1efe8");
    P(box(0.13, 0.03, roomDepth, x, CEILING + 0.015, (OFFICES.z0 + front) / 2), "#3c4641");
  });
  // glass office fronts on the corridor, each with a door near its east end
  OFFICES.rooms.slice(0, -1).forEach((x0, i) => {
    const x1 = OFFICES.rooms[i + 1], gap = [x1 - 1.7, x1 - 0.6];
    for (let x = x0 + 0.1; x + 1.2 <= x1 - 0.05; x += 1.2) {
      if (x + 1.2 > gap[0] && x < gap[1]) continue; // the office door
      frost.push(box(1.18, CEILING, 0.03, x + 0.6, CEILING / 2, front));
      P(box(0.05, CEILING, 0.06, x, CEILING / 2, front), ALUM, 0.7, 0.35);
    }
    P(box(x1 - x0, 0.05, 0.08, (x0 + x1) / 2, CEILING - 0.02, front), ALUM, 0.7, 0.35);
  });
  bake(frost, frostMat, false);
  bake([
    box(DOOR.w / 2 - 0.04, 2.2, 0.04, DOOR.x - DOOR.w / 4, 1.1, AREA.z0 + WT / 2),
    box(DOOR.w / 2 - 0.04, 2.2, 0.04, DOOR.x + DOOR.w / 4, 1.1, AREA.z0 + WT / 2),
  ], clearGlass, false);

  // Furniture is not part of the room: the office map draws every piece of
  // the plan live, so it can be picked up, turned and removed.
  bake(painted, paintMat, true);

  return {
    group,
    /** A material for the live furniture that takes part in the same cut-away. */
    furnitureMaterial() {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, cut);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vCutPos;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vCutPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
            #else
              vCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            #endif`,
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vCutPos;\nuniform float uCutOn;\nuniform vec3 uCutA;\nuniform vec3 uCutB;\nuniform float uCutR;",
          )
          .replace(
            "#include <clipping_planes_fragment>",
            `#include <clipping_planes_fragment>
            if (uCutOn > 0.5) {
              vec3 ab = uCutB - uCutA;
              float t = clamp(dot(vCutPos - uCutA, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
              if (t < 0.85 && distance(vCutPos, uCutA + ab * t) < uCutR) discard;
            }`,
          );
      };
      material.customProgramCacheKey = () => "verlet-furniture";
      return material;
    },
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

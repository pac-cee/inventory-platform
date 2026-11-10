import {
  ITEM_DRAG_TYPE,
  type ItemTransfer,
  type BoxAddress,
} from "@/lib/spatial/item-transfer";
import { resolveSlots, occupiedLevels } from "@/lib/spatial/box-placement";
import { shelfLevels, snapShelf } from "@/lib/spatial/builder";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  createVerletFloor,
  skyTexture,
  HALL_CENTER,
  HALL_HALF_WIDTH,
  SKY,
  SUN_DIRECTION,
} from "./verlet/floor";
import {
  framingDistance,
  clampZoomDistance,
  followObject,
  type ObjectPose,
} from "@/lib/spatial/camera";
import type { FloorPoint } from "@/lib/spatial/directions";
import { type SpatialShelf } from "@/lib/spatial/model";

export function createOffice(
  host: HTMLDivElement,
  shelves: SpatialShelf[],
  floorImage: string | null,
  select: (id: string, boxId?: string) => void,
) {
  const scene = new THREE.Scene();
  // Verlet's floor from the 3D floor site, high up in its office block.
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.Fog(SKY.horizon, 90, 300);
  const verlet = createVerletFloor();
  scene.add(verlet.group);
  // Overview framing: the whole hall, seen from the south-east like the 5190 site.
  const OVERVIEW = HALL_CENTER.clone().add(new THREE.Vector3(30, 34, 40));
  const PLAN = HALL_CENTER.clone().add(new THREE.Vector3(0, 56, 0.01));
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is gone in three r187; PCF with a radius gives the soft edge.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D office. Drag to orbit, scroll to zoom. Select a box to focus it. Use Inspect box for an unobstructed full orbit. Equivalent box controls are in the location list.",
  );
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.tabIndex = 0;
  host.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 320);
  camera.position.copy(OVERVIEW);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HALL_CENTER);
  controls.enableDamping = true;
  controls.minDistance = 0.45;
  controls.maxDistance = 80;
  controls.minPolarAngle = 0.01;
  controls.maxPolarAngle = Math.PI - 0.01;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.update();

  // ---- light: a soft studio environment for reflections and fill, one warm sun for shadows
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environment = environment;
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x7a6a58, 0.75));
  // One sun, its shadow box fitted round the whole hall.
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
  sun.target.position.copy(HALL_CENTER);
  sun.position.copy(HALL_CENTER).addScaledVector(SUN_DIRECTION, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 170;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // ---- surfaces, drawn once on canvases so nothing extra is downloaded
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  function surface(
    size: number,
    draw: (ctx: CanvasRenderingContext2D, s: number) => void,
    repeat: [number, number] = [1, 1],
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    draw(canvas.getContext("2d")!, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = maxAniso;
    return texture;
  }
  // Seeded noise so the floor looks the same on every visit.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  function speckle(ctx: CanvasRenderingContext2D, s: number, n: number, dark: string, light: string) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rand() > 0.5 ? dark : light;
      ctx.globalAlpha = 0.05 + rand() * 0.08;
      const r = 0.6 + rand() * 1.6;
      ctx.fillRect(rand() * s, rand() * s, r, r);
    }
    ctx.globalAlpha = 1;
  }
  // Kraft cardboard: near-white fibres, tinted per box by vertex colour.
  const kraftMap = surface(256, (ctx, s) => {
    ctx.fillStyle = "#f4efe6";
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 6) {
      ctx.fillStyle = "rgba(120,96,64,0.06)";
      ctx.fillRect(x, 0, 2, s);
    }
    speckle(ctx, s, 2600, "#6b5236", "#ffffff");
  });
  // Birch plywood decks and table tops.
  const plyMap = surface(256, (ctx, s) => {
    ctx.fillStyle = "#f1e6d2";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 3 + rand() * 5) {
      ctx.strokeStyle = `rgba(150,112,66,${0.05 + rand() * 0.09})`;
      ctx.lineWidth = 0.6 + rand() * 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) ctx.lineTo(x, y + Math.sin(x / 40 + y) * 2.2);
      ctx.stroke();
    }
    speckle(ctx, s, 900, "#8a6a44", "#fffaf0");
  });
  const contactMap = surface(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(28,36,32,0.55)");
    g.addColorStop(0.55, "rgba(28,36,32,0.22)");
    g.addColorStop(1, "rgba(28,36,32,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  contactMap.wrapS = contactMap.wrapT = THREE.ClampToEdgeWrapping;

  // One material per surface type; colour comes from the vertices, so each
  // shelf, wall or plant is a single draw call however many parts it has.
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 });
  const kraft = new THREE.MeshStandardMaterial({ vertexColors: true, map: kraftMap, roughness: 0.92 });
  // Racks and tables: steel and plywood in one mesh. A per-vertex "surface"
  // attribute (metalness, roughness) picks steel or wood, and only wood takes
  // the grain texture, so a whole rack is one draw call.
  const rack = new THREE.MeshStandardMaterial({ vertexColors: true, map: plyMap, roughness: 1, metalness: 1 });
  rack.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 surface;\nvarying vec2 vSurface;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurface = surface;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSurface;")
      .replace(
        "#include <map_fragment>",
        "#ifdef USE_MAP\n  diffuseColor *= mix(texture2D(map, vMapUv), vec4(1.0), step(0.01, vSurface.x));\n#endif",
      )
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= vSurface.x;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= vSurface.y;");
  };
  function surfaced(g: THREE.BufferGeometry, metal: boolean) {
    const v = new Float32Array(g.attributes.position.count * 2);
    for (let i = 0; i < v.length; i += 2) {
      v[i] = metal ? 0.55 : 0;
      v[i + 1] = metal ? 0.4 : 0.62;
    }
    g.setAttribute("surface", new THREE.BufferAttribute(v, 2));
    return g;
  }
  const contact = new THREE.MeshBasicMaterial({
    map: contactMap,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  /** A geometry part placed in its parent's space and painted one colour. */
  function part(
    geometry: THREE.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes))
      if (!["position", "normal", "uv", "surface"].includes(name)) g.deleteAttribute(name);
    quat.setFromEuler(euler.set(rx, ry, rz, "YXZ"));
    g.applyMatrix4(
      matrix.compose(new THREE.Vector3(x, y, z), quat, new THREE.Vector3(sx, sy, sz)),
    );
    const c = new THREE.Color(color);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }
  const slab = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) =>
    part(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  /** Merge parts into one mesh. */
  function bake(
    parent: THREE.Object3D,
    parts: THREE.BufferGeometry[],
    mat: THREE.Material,
    cast = true,
  ) {
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, mat);
    parts.forEach((p) => p.dispose());
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function contactShadow(parent: THREE.Object3D, w: number, d: number, y = 0.05) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), contact);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = -1;
    parent.add(mesh);
    return mesh;
  }

  const fontFamily =
    getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  function label(
    parent: THREE.Object3D,
    text: string,
    x: number,
    y: number,
    z: number,
    width = 2.5,
    dark = false,
    sticker = false,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = dark ? "#222a27" : "#f8f9f5";
    ctx.beginPath();
    ctx.roundRect(4, 4, 760, 120, sticker ? 14 : 22);
    ctx.fill();
    if (sticker) {
      // A printed barcode strip, like the QR labels the app prints.
      ctx.fillStyle = "#39433e";
      let bx = 34;
      while (bx < 150) {
        const w = 2 + Math.round(rand() * 6);
        ctx.fillRect(bx, 30, w, 68);
        bx += w + 3 + Math.round(rand() * 4);
      }
    }
    ctx.font = `600 ${sticker ? 44 : 40}px ${fontFamily}`;
    ctx.fillStyle = dark ? "#f8f9f5" : "#39433e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const left = sticker ? 170 : 24;
    ctx.fillText(
      text.length > 26 ? text.slice(0, 25) + "…" : text,
      (left + 744) / 2,
      66,
      744 - left,
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAniso;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 6),
      new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
      }),
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // ---- the inventory floor's own fittings (the hall round it comes from verlet/floor)
  const shell: THREE.BufferGeometry[] = [];
  // Glass partition frames, with a walk-through opening.
  for (const x of [-6.5, -2.5])
    for (const dx of [-1.75, 1.75]) shell.push(slab(0.05, 2.2, 0.08, "#7e8c83", x + dx, 1.1, 0.8));
  for (const x of [-6.5, -2.5]) shell.push(slab(3.55, 0.05, 0.09, "#7e8c83", x, 2.18, 0.8));

  // Plants: tapered pot, soil, and a fan of long leaves.
  function plant(x: number, z: number) {
    shell.push(
      part(new THREE.CylinderGeometry(0.34, 0.25, 0.62, 20), "#d4d3c9", x, 0.31, z),
      part(new THREE.CylinderGeometry(0.355, 0.34, 0.05, 20), "#c2c1b6", x, 0.62, z),
      part(new THREE.CylinderGeometry(0.31, 0.31, 0.02, 16), "#4a3b2e", x, 0.6, z),
    );
    const n = 15;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + x;
      const tilt = 0.18 + (i / n) * 0.62;
      const length = 1.25 - (i / n) * 0.55 + rand() * 0.15;
      const dir = new THREE.Vector3(
        Math.sin(tilt) * Math.sin(a),
        Math.cos(tilt),
        Math.sin(tilt) * Math.cos(a),
      );
      const c = dir.multiplyScalar(length / 2);
      shell.push(
        part(
          new THREE.SphereGeometry(1, 10, 8),
          i % 3 === 0 ? "#6f9174" : i % 3 === 1 ? "#4a6e55" : "#3d5f48",
          x + c.x,
          0.62 + c.y,
          z + c.z,
          tilt,
          a,
          0,
          0.075,
          length / 2,
          0.022,
        ),
      );
    }
  }
  plant(-8.8, 5.7);
  plant(8.8, -5.7);
  plant(8.8, 5.7);
  bake(scene, shell, paint);
  for (const [x, z] of [
    [-8.8, 5.7],
    [8.8, -5.7],
    [8.8, 5.7],
  ])
    contactShadow(scene, 1.3, 1.3, 0.052).position.set(x, 0.052, z);

  // The hall's tiles are the floor; this stands in for the old floor slab,
  // which a custom floor-plan image used to hide.
  const floor = new THREE.Object3D();

  const entrance = label(scene, "ENTRANCE", 0, 0.09, 6.5, 2.2, true);
  entrance.rotation.x = -Math.PI / 2;
  const startMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.035, 24),
    new THREE.MeshBasicMaterial({ color: 0xdc7298 }),
  );
  startMarker.position.set(0, 0.1, 6);
  scene.add(startMarker);
  const glass = new THREE.MeshStandardMaterial({
    color: 0xd4e6e0,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0.1,
    envMapIntensity: 1.6,
  });
  for (const x of [-6.5, -2.5]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.1, 0.03), glass);
    panel.position.set(x, 1.1, 0.8);
    scene.add(panel);
  }
  const roomLabel = label(scene, "STORAGE / 01", -4.4, 0.08, -5.8, 3.2);
  roomLabel.rotation.x = -Math.PI / 2;
  const labLabel = label(scene, "WORKSPACE / 02", 4.7, 0.08, 5.6, 3.5);
  labLabel.rotation.x = -Math.PI / 2;

  const targets: THREE.Object3D[] = [];
  const boxTargets: THREE.Object3D[] = [];
  const packages = new Map<string, THREE.Group>();
  const boxOutlines = new Map<string, THREE.LineSegments>();
  const rings = new Map<string, THREE.Mesh>();
  const groups = new Map<string, THREE.Group>();
  const POST = "#46544d", BEAM = "#56665d", FOOT = "#2f3833", DECK = "#e4cfac";
  // The old website's steel racks (and their boxes) are hidden: the map shows
  // the Verlet hall as it is on the 3D floor site. Set to true to bring them
  // back; inventory, boxes and locations are unaffected either way.
  const SHOW_RACKS = false;
  for (const shelf of shelves) {
    if (shelf.kind !== "table" && !SHOW_RACKS) continue;
    const group = new THREE.Group();
    group.position.set(shelf.x, 0, shelf.z);
    group.rotation.y = THREE.MathUtils.degToRad(shelf.rotation);
    scene.add(group);
    groups.set(shelf.id, group);
    if (shelf.kind === "table") {
      const legs: THREE.BufferGeometry[] = [];
      for (const x of [-1.1, 1.1]) {
        for (const z of [-0.5, 0.5]) {
          legs.push(slab(0.06, 0.96, 0.06, POST, x, 0.48, z));
          legs.push(slab(0.1, 0.015, 0.1, FOOT, x, 0.0075, z));
        }
        legs.push(slab(0.04, 0.04, 1.0, BEAM, x, 0.18, 0));
      }
      legs.push(slab(2.2, 0.06, 0.03, BEAM, 0, 0.935, -0.5), slab(2.2, 0.06, 0.03, BEAM, 0, 0.935, 0.5));
      bake(group, [
        surfaced(part(new RoundedBoxGeometry(2.6, 0.07, 1.3, 2, 0.025), DECK, 0, 1.0, 0), false),
        ...legs.map((g) => surfaced(g, true)),
      ], rack);
      contactShadow(group, 3.1, 1.8);
      const ring = new THREE.Mesh(
        new THREE.BoxGeometry(2.9, 0.035, 1.6),
        new THREE.MeshBasicMaterial({
          color: 0x9db7a4,
          transparent: true,
          opacity: 0.2,
        }),
      );
      ring.position.y = 0.09;
      group.add(ring);
      rings.set(shelf.id, ring);
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 1.2, 1.5),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.position.y = 0.6;
      hit.userData.shelfId = shelf.id;
      group.add(hit);
      targets.push(hit);
      continue;
    }
    const boxes = resolveSlots(shelf.boxes ?? []);
    const levels = Math.max(
      shelfLevels(shelf.levels, boxes.length),
      occupiedLevels(boxes),
    );
    const top = 0.26 + levels * 0.78;
    // Boltless steel racking: posts, foot plates, beams and side bracing in one
    // mesh; plywood decks in another.
    const frame: THREE.BufferGeometry[] = [];
    const decks: THREE.BufferGeometry[] = [];
    for (const x of [-1.28, 1.28]) {
      for (const z of [-0.48, 0.48]) {
        frame.push(slab(0.07, top + 0.1, 0.07, POST, x, top / 2, z));
        frame.push(slab(0.13, 0.015, 0.13, FOOT, x, 0.0075, z));
      }
      // Zig-zag side bracing between the two posts of each end frame.
      const span = 0.96;
      for (let level = 0; level < levels; level++) {
        const y0 = 0.25 + level * 0.78, y1 = y0 + 0.78;
        const rise = y1 - y0 - 0.12;
        const len = Math.hypot(rise, span - 0.1);
        const lean = Math.atan2(span - 0.1, rise) * (level % 2 ? 1 : -1);
        frame.push(
          part(new THREE.BoxGeometry(0.025, len, 0.02), BEAM, x, (y0 + y1) / 2, 0, lean),
        );
      }
    }
    for (let level = 0; level <= levels; level++) {
      const y = 0.25 + level * 0.78;
      for (const z of [-0.5, 0.5])
        frame.push(slab(2.5, 0.07, 0.035, BEAM, 0, y - 0.035, z));
      for (const x of [-1.28, 1.28])
        frame.push(slab(0.04, 0.05, 0.96, BEAM, x, y - 0.03, 0));
      decks.push(slab(2.5, 0.03, 0.97, DECK, 0, y + 0.025, 0));
    }
    bake(group, [...frame.map((g) => surfaced(g, true)), ...decks.map((g) => surfaced(g, false))], rack);
    contactShadow(group, 3.3, 1.7);
    const quantity = shelf.items.reduce((n, item) => n + item.quantity, 0);
    boxes.forEach((storage) => {
      const level = Math.floor(storage.slot / 4),
        col = storage.slot % 4;
      const x = -0.94 + col * 0.62,
        y = 0.54 + level * 0.78;
      const packageGroup = new THREE.Group();
      packageGroup.position.set(x, y, 0);
      group.add(packageGroup);
      packages.set(storage.id, packageGroup);
      const full = storage.items.some((item) => item.quantity > 0);
      // Kraft for boxes holding stock, a paler bleached board for empty ones.
      const tint = full ? "#c9a476" : "#ddd5c6";
      const packageMesh = bake(
        packageGroup,
        [
          part(new RoundedBoxGeometry(0.48, 0.48, 0.7, 2, 0.018), tint, 0, 0, 0),
          slab(0.075, 0.008, 0.705, "#b08b5c", 0, 0.241, 0),
          slab(0.075, 0.16, 0.008, "#b08b5c", 0, 0.165, 0.351),
          slab(0.075, 0.16, 0.008, "#b08b5c", 0, 0.165, -0.351),
        ],
        kraft,
        false,
      );
      packageMesh.userData = { shelfId: shelf.id, boxId: storage.id };
      boxTargets.push(packageMesh);
      const sticker = label(packageGroup, storage.name, 0, -0.03, 0.357, 0.43, false, true);
      sticker.userData = { shelfId: shelf.id, boxId: storage.id };
      boxTargets.push(sticker);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 0.5, 0.72)),
        new THREE.LineBasicMaterial({ color: 0xef83ad }),
      );
      outline.userData.boxId = storage.id;
      outline.visible = false;
      packageGroup.add(outline);
      boxOutlines.set(storage.id, outline);
    });
    label(group, shelf.name, 0, top + 0.29, 0.05, 2.7, true);
    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(3.05, 0.035, 1.5),
      new THREE.MeshBasicMaterial({
        color: quantity ? 0x9db7a4 : 0xe9bc79,
        transparent: true,
        opacity: 0.3,
      }),
    );
    ring.position.y = 0.09;
    group.add(ring);
    rings.set(shelf.id, ring);
    // A transparent hit volume keeps small struts and empty shelves easy to select.
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, top + 0.45, 1.3),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = top / 2;
    hit.userData.shelfId = shelf.id;
    group.add(hit);
    targets.push(hit);
  }
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  function clearRoute() {
    for (const object of [...routeGroup.children]) {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material)
          ? object.material
          : [object.material];
        mats.forEach((m) => m.dispose());
      }
      routeGroup.remove(object);
    }
  }
  function drawRoute(points: FloorPoint[]) {
    clearRoute();
    for (let i = 1; i < points.length; i++) {
      const a = new THREE.Vector3(points[i - 1].x, 0.12, points[i - 1].z),
        b = new THREE.Vector3(points[i].x, 0.12, points[i].z);
      const direction = b.clone().sub(a);
      const segment = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, direction.length(), 8),
        new THREE.MeshBasicMaterial({ color: 0xd34f85 }),
      );
      segment.position.copy(a).add(b).multiplyScalar(0.5);
      segment.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      );
      routeGroup.add(segment);
      if (i % 4 === 0) {
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.13, 0.35, 3),
          new THREE.MeshBasicMaterial({ color: 0xd34f85 }),
        );
        arrow.position.copy(b);
        arrow.quaternion.copy(segment.quaternion);
        routeGroup.add(arrow);
      }
    }
  }
  let disposed = false;
  if (floorImage)
    new THREE.TextureLoader().load(floorImage, (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      const plan = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 14),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
        }),
      );
      plan.rotation.x = -Math.PI / 2;
      plan.position.y = 0.07;
      scene.add(plan);
      floor.visible = false;
    });
  let detail = false;
  let focusAnchor: { id: string; boxId?: string | null } | null = null;
  function focusedObject() {
    return focusAnchor
      ? focusAnchor.boxId
        ? packages.get(focusAnchor.boxId)
        : groups.get(focusAnchor.id)
      : undefined;
  }
  function pose(object: THREE.Object3D): ObjectPose {
    const q = object.getWorldQuaternion(new THREE.Quaternion());
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    return {
      position: object.getWorldPosition(new THREE.Vector3()).toArray(),
      yaw: Math.atan2(front.x, front.z),
    };
  }
  function bounds(object: THREE.Object3D) {
    object.updateWorldMatrix(true, true);
    return new THREE.Box3()
      .setFromObject(object)
      .getBoundingSphere(new THREE.Sphere());
  }
  let inspection: THREE.Group | null = null;
  let isolatedId: string | null = null;
  const visibility = new Map<THREE.Object3D, boolean>();
  function isolateBox(id: string | null) {
    if (id === isolatedId) return;
    if (inspection) {
      scene.remove(inspection);
      inspection = null;
    }
    visibility.forEach((visible, object) => {
      object.visible = visible;
    });
    visibility.clear();
    isolatedId = null;
    const source = id ? (packages.get(id) ?? groups.get(id)) : undefined;
    if (!source) return;
    scene.children.forEach((object) => {
      if (!(object instanceof THREE.Light)) {
        visibility.set(object, object.visible);
        object.visible = false;
      }
    });
    inspection = source.clone(true);
    source.getWorldPosition(inspection.position);
    source.getWorldQuaternion(inspection.quaternion);
    source.getWorldScale(inspection.scale);
    inspection.visible = true;
    scene.add(inspection);
    isolatedId = id;
  }
  let flight: {
    start: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    targetFrom: THREE.Vector3;
    targetTo: THREE.Vector3;
  } | null = null;
  function cancelFlight() {
    flight = null;
  }
  controls.addEventListener("start", cancelFlight);
  function flyTo(position: THREE.Vector3, target: THREE.Vector3) {
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      return;
    }
    flight = {
      start: performance.now(),
      from: camera.position.clone(),
      to: position,
      targetFrom: controls.target.clone(),
      targetTo: target,
    };
  }
  function focusObject(id: string, boxId?: string | null) {
    const inspectBox = !!boxId && isolatedId === boxId;
    const object = boxId ? packages.get(boxId) : groups.get(id);
    if (!object) return;
    focusAnchor = { id, boxId };
    detail = true;
    controls.enableRotate = true;
    camera.fov = 42;
    camera.updateProjectionMatrix();
    const sphere = bounds(object),
      target = sphere.center;
    // Keep the normal view straight-on, framing a box with its shelf around it.
    const direction = new THREE.Vector3(
      inspectBox ? 0.48 : 0,
      inspectBox ? 0.25 : 0,
      1,
    )
      .normalize()
      .applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
    const radius = boxId
      ? inspectBox
        ? sphere.radius * 1.35
        : Math.max(1.1, sphere.radius)
      : sphere.radius;

    const distance = framingDistance(radius, 42, camera.aspect);
    flyTo(target.clone().addScaledVector(direction, distance), target);
  }
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let arrangeShelf: string | null = null;
  let placePackage: ((id: string, slot: number) => void) | null = null;
  let boxDrag: {
    id: string;
    group: THREE.Group;
    origin: THREE.Vector3;
    slot: number;
  } | null = null;
  function restoreBoxDrag() {
    if (boxDrag) {
      boxDrag.group.position.copy(boxDrag.origin);
      boxDrag = null;
      controls.enabled = true;
    }
  }
  let editing = false;
  let moveShelf: ((id: string, x: number, z: number) => void) | null = null;
  let drag: {
    id: string;
    offset: THREE.Vector3;
    origin: THREE.Vector3;
  } | null = null;
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function floorPoint(e: PointerEvent) {
    const b = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - b.left) / b.width) * 2 - 1,
      -((e.clientY - b.top) / b.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    return ray.ray.intersectPlane(ground, new THREE.Vector3());
  }
  let down = { x: 0, y: 0 };
  const pointers = new Set<number>();
  let gesture = false;
  const onDown = (e: PointerEvent) => {
    renderer.domElement.focus({ preventScroll: true });
    pointers.add(e.pointerId);
    if (pointers.size === 1) {
      down = { x: e.clientX, y: e.clientY };
      gesture = false;
    } else gesture = true;
    if (editing && e.button === 0 && pointers.size === 1) {
      const hit = hitAt(e);
      if (arrangeShelf && hit?.boxId && hit.shelfId === arrangeShelf) {
        const group = packages.get(hit.boxId)!;
        cancelFlight();
        boxDrag = {
          id: hit.boxId,
          group,
          origin: group.position.clone(),
          slot: resolveSlots(
            shelves.find((s) => s.id === arrangeShelf)?.boxes ?? [],
          ).find((b) => b.id === hit.boxId)!.slot,
        };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
      if (arrangeShelf) return;
      const point = floorPoint(e);
      const group = hit ? groups.get(hit.shelfId) : null;
      if (group && point && hit) {
        cancelFlight();
        rings.forEach((r, key) => {
          (r.material as THREE.MeshBasicMaterial).opacity =
            key === hit.shelfId ? 0.8 : 0.2;
        });
        drag = {
          id: hit.shelfId,
          offset: point.sub(group.position),
          origin: group.position.clone(),
        };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
  };
  function hitAt(e: Pick<PointerEvent, "clientX" | "clientY">) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((e.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    if (editing && !arrangeShelf) {
      return ray.intersectObjects(targets)[0]?.object.userData as
        | { shelfId: string; boxId?: string }
        | undefined;
    }
    const hits = inspection
      ? ray.intersectObject(inspection, true)
      : ray.intersectObjects(boxTargets);
    return (
      hits.find(
        (hit) => hit.object.userData.boxId && hit.object.userData.shelfId,
      ) ??
      hits.find((hit) => hit.object.userData.shelfId) ??
      (!inspection ? ray.intersectObjects(targets)[0] : undefined)
    )?.object.userData as { shelfId: string; boxId?: string } | undefined;
  }
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (boxDrag) {
      const d = boxDrag;
      restoreBoxDrag();
      if (!gesture) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 6)
          placePackage?.(d.id, d.slot);
        else if (arrangeShelf) select(arrangeShelf, d.id);
      }
      return;
    }
    if (drag) {
      const d = drag;
      drag = null;
      controls.enabled = true;
      const g = groups.get(d.id)!;
      if (gesture) {
        g.position.copy(d.origin);
        return;
      }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 6)
        moveShelf?.(d.id, g.position.x, g.position.z);
      else select(d.id);
      return;
    }
    if (
      !gesture &&
      e.button === 0 &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6
    ) {
      const hit = hitAt(e);
      if (hit) select(hit.shelfId, hit.boxId);
    }
  };
  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    gesture = true;
    restoreBoxDrag();
    if (drag) {
      groups.get(drag.id)?.position.copy(drag.origin);
      drag = null;
      controls.enabled = true;
    }
  };
  const onMove = (e: PointerEvent) => {
    if (boxDrag && arrangeShelf) {
      if (gesture) return;
      const shelfGroup = groups.get(arrangeShelf)!;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((e.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0).applyMatrix4(
        shelfGroup.matrixWorld,
      );
      const point = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (point) {
        shelfGroup.worldToLocal(point);
        const shelf = shelves.find((s) => s.id === arrangeShelf)!;
        const levels = Math.max(
          shelfLevels(shelf.levels, shelf.boxes?.length ?? 0),
          occupiedLevels(shelf.boxes ?? []),
        );
        const col = Math.max(
            0,
            Math.min(3, Math.round((point.x + 0.94) / 0.62)),
          ),
          level = Math.max(
            0,
            Math.min(levels - 1, Math.round((point.y - 0.54) / 0.78)),
          );
        boxDrag.slot = level * 4 + col;
        boxDrag.group.position.set(-0.94 + col * 0.62, 0.54 + level * 0.78, 0);
      }
      return;
    }
    if (drag) {
      if (gesture) return;
      const point = floorPoint(e);
      if (point) {
        point.sub(drag.offset);
        const p = snapShelf({ x: point.x, z: point.z, rotation: 0 });
        groups.get(drag.id)?.position.set(p.x, 0, p.z);
      }
      return;
    }
    renderer.domElement.style.cursor = hitAt(e)
      ? editing
        ? "move"
        : "pointer"
      : "grab";
  };
  renderer.domElement.addEventListener("pointercancel", onCancel);
  renderer.domElement.addEventListener("pointerdown", onDown, true);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);
  let receiveItem: ((move: ItemTransfer, target: BoxAddress) => void) | null =
    null;
  let selectedBoxId: string | null = null;
  function itemTarget(e: DragEvent) {
    const b = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - b.left) / b.width) * 2 - 1,
      -((e.clientY - b.top) / b.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const hit = (
      inspection
        ? ray.intersectObject(inspection, true)
        : ray.intersectObjects(boxTargets)
    ).find((h) => h.object.userData.boxId && h.object.userData.shelfId);
    return hit?.object.userData as
      | { shelfId: string; boxId: string }
      | undefined;
  }
  const itemOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(ITEM_DRAG_TYPE)) return;
    e.preventDefault();
    const hit = itemTarget(e);
    e.dataTransfer.dropEffect = hit
      ? e.dataTransfer.effectAllowed === "copy"
        ? "copy"
        : "move"
      : "none";
    boxOutlines.forEach((o, id) => {
      o.visible = id === selectedBoxId || id === hit?.boxId;
    });
  };
  const itemLeave = () =>
    boxOutlines.forEach((o, id) => {
      o.visible = id === selectedBoxId;
    });
  const itemDrop = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(ITEM_DRAG_TYPE)) return;
    e.preventDefault();
    const hit = itemTarget(e);
    itemLeave();
    if (!hit) return;
    try {
      receiveItem?.(JSON.parse(e.dataTransfer.getData(ITEM_DRAG_TYPE)), {
        shelfId: hit.shelfId,
        boxId: hit.boxId,
      });
    } catch {
      /* Ignore malformed external payloads. */
    }
  };
  renderer.domElement.addEventListener("dragover", itemOver);
  renderer.domElement.addEventListener("dragleave", itemLeave);
  renderer.domElement.addEventListener("drop", itemDrop);
  function fitProjection() {
    const { width, height } = host.getBoundingClientRect();
    camera.aspect = width / Math.max(1, height);
    const distance = camera.position.distanceTo(controls.target);
    const fit = THREE.MathUtils.radToDeg(
      2 * Math.atan(HALL_HALF_WIDTH / (Math.max(1, distance) * camera.aspect)),
    );
    camera.fov = detail
      ? 42
      : Math.max(
          controls.enableRotate ? (width < 600 ? 55 : 36) : 30,
          Math.min(75, fit),
        );
    camera.updateProjectionMatrix();
  }
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height);
    fitProjection();
    const object = focusedObject();
    if (detail && object) {
      const offset = camera.position.clone().sub(controls.target);
      const minimum = framingDistance(bounds(object).radius, 42, camera.aspect);
      if (offset.length() < minimum) {
        camera.position.copy(controls.target).add(offset.setLength(minimum));
        controls.update();
      }
    }
  });
  resize.observe(host);
  renderer.setAnimationLoop(() => {
    if (document.hidden) return;
    if (flight) {
      const t = Math.min(1, (performance.now() - flight.start) / 320);
      const eased = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(flight.from, flight.to, eased);
      controls.target.lerpVectors(flight.targetFrom, flight.targetTo, eased);
      if (t === 1) flight = null;
    }
    controls.update();
    renderer.render(scene, camera);
  });
  return {
    itemDrop(callback: (move: ItemTransfer, target: BoxAddress) => void) {
      receiveItem = callback;
    },
    arrange(id: string | null, onPlace: (id: string, slot: number) => void) {
      arrangeShelf = id;
      placePackage = onPlace;
    },
    editing(
      enabled: boolean,
      onMove: (id: string, x: number, z: number) => void,
    ) {
      editing = enabled;
      moveShelf = onMove;
    },
    route(points: FloorPoint[]) {
      drawRoute(points);
    },
    select(id: string | null, boxId?: string | null) {
      selectedBoxId = boxId ?? null;
      inspection?.traverse((object) => {
        if (object instanceof THREE.LineSegments && object.userData.boxId)
          object.visible = object.userData.boxId === boxId;
      });
      boxOutlines.forEach((outline, key) => {
        outline.visible = key === boxId;
      });
      rings.forEach((ring, key) => {
        const m = ring.material as THREE.MeshBasicMaterial;
        m.opacity = key === id ? 0.8 : 0.2;
        m.color.set(
          key === id
            ? "#df799a"
            : shelves
                  .find((s) => s.id === key)
                  ?.items.some((i) => i.quantity > 0)
              ? "#9db7a4"
              : "#e9bc79",
        );
      });
    },
    snapshot() {
      const object = focusedObject();
      return {
        position: (flight?.to ?? camera.position).toArray(),
        target: (flight?.targetTo ?? controls.target).toArray(),
        rotate: controls.enableRotate,
        detail,
        anchor:
          object && focusAnchor
            ? {
                ...focusAnchor,
                pose: pose(object),
                radius: bounds(object).radius,
              }
            : null,
      };
    },
    isolate(id: string | null) {
      isolateBox(id);
    },
    restore(state: {
      position: number[];
      target: number[];
      rotate: boolean;
      detail?: boolean;
      anchor?: {
        id: string;
        boxId?: string | null;
        pose: ObjectPose;
        radius: number;
      } | null;
    }) {
      detail = !!state.detail;
      focusAnchor = state.anchor
        ? { id: state.anchor.id, boxId: state.anchor.boxId }
        : null;
      const object = focusedObject();
      let position = state.position,
        target = state.target;
      if (object && state.anchor && detail) {
        const next = pose(object);
        position = followObject(position, state.anchor.pose, next);
        target = followObject(target, state.anchor.pose, next);
        const sphere = bounds(object);
        if (Math.abs(sphere.radius - state.anchor.radius) > 0.01) {
          target = sphere.center.toArray();
          const offset = new THREE.Vector3()
            .fromArray(position)
            .sub(new THREE.Vector3().fromArray(target));
          position = new THREE.Vector3()
            .fromArray(target)
            .add(
              offset.setLength(
                framingDistance(sphere.radius, 42, camera.aspect),
              ),
            )
            .toArray();
        }
      }
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.enableRotate = state.rotate;
      controls.update();
      fitProjection();
    },
    view(plan: boolean) {
      cancelFlight();
      detail = false;
      focusAnchor = null;
      isolateBox(null);
      controls.target.copy(HALL_CENTER);
      camera.position.copy(plan ? PLAN : OVERVIEW);
      controls.enableRotate = !plan;
      controls.update();
      fitProjection();
    },
    zoom(factor: number) {
      cancelFlight();
      const delta = camera.position.clone().sub(controls.target);
      camera.position
        .copy(controls.target)
        .add(delta.setLength(clampZoomDistance(delta.length() * factor)));
      controls.update();
    },
    focus(id: string, boxId?: string | null) {
      focusObject(id, boxId);
    },
    orbit(angle: number) {
      cancelFlight();
      if (!controls.enableRotate) return;
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    dispose() {
      disposed = true;
      renderer.domElement.removeEventListener("dragover", itemOver);
      renderer.domElement.removeEventListener("dragleave", itemLeave);
      renderer.domElement.removeEventListener("drop", itemDrop);
      controls.removeEventListener("start", cancelFlight);
      if (inspection) scene.remove(inspection);
      resize.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.domElement.removeEventListener("pointercancel", onCancel);
      renderer.domElement.removeEventListener("pointerdown", onDown, true);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      const textures = new Set<THREE.Texture>();
      const mats = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          for (const m of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            mats.add(m);
            if ("map" in m && m.map) textures.add(m.map as THREE.Texture);
          }
        }
        if (object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const m = object.material;
          if (Array.isArray(m)) m.forEach((x) => mats.add(x));
          else mats.add(m);
        }
      });
      textures.forEach((t) => t.dispose());
      mats.forEach((m) => m.dispose());
      sun.shadow.dispose();
      verlet.dispose();
      sky.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

import {
  ITEM_DRAG_TYPE,
  type ItemTransfer,
  type BoxAddress,
} from "@/lib/spatial/item-transfer";
import { resolveSlots, occupiedLevels } from "@/lib/spatial/box-placement";
import { shelfLevels, snapShelf } from "@/lib/spatial/builder";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
  scene.background = new THREE.Color("#e7e9e6");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive 3D office. Drag to orbit, scroll to zoom. Select a box to focus it. Use Inspect box for an unobstructed full orbit. Equivalent box controls are in the location list.",
  );
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.tabIndex = 0;
  host.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 200);
  camera.position.set(22, 23, 27);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.45;
  controls.maxDistance = 80;
  controls.minPolarAngle = 0.01;
  controls.maxPolarAngle = Math.PI - 0.01;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa6afa7, 2.7));
  const sun = new THREE.DirectionalLight(0xfff5e6, 4);
  sun.position.set(-9, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: string) {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.78,
          metalness: 0.04,
        }),
      );
    return materials.get(color)!;
  }
  function box(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      material(color),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function label(
    parent: THREE.Object3D,
    text: string,
    x: number,
    y: number,
    z: number,
    width = 2.5,
    dark = false,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = dark ? "#222a27" : "#f8f9f5";
    ctx.fillRect(0, 0, 768, 128);
    ctx.font = "500 40px sans-serif";
    ctx.fillStyle = dark ? "#f8f9f5" : "#39433e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      text.length > 26 ? text.slice(0, 25) + "…" : text,
      384,
      64,
      730,
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 6),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  // Cutaway architectural shell; front walls are intentionally omitted for visibility.
  box(scene, 0, -0.3, 0, 21, 0.6, 15, "#c8cfca");
  const floor = box(scene, 0, 0.02, 0, 20, 0.05, 14, "#f2f0e9");
  box(scene, 0, -0.7, 0, 200, 0.1, 200, "#e7e9e6");
  const grid = new THREE.GridHelper(20, 20, 0xc4ccc6, 0xdcded8);
  grid.position.y = 0.06;
  grid.scale.z = 0.7;
  scene.add(grid);
  box(scene, 0, 1.15, -7, 20, 2.3, 0.15, "#f9f9f2");
  box(scene, -10, 1.15, 0, 0.15, 2.3, 14, "#ebeee6");
  box(scene, 10, 0.22, 0, 0.15, 0.44, 14, "#f9f9f2");
  for (const x of [-5.5, 5.5]) box(scene, x, 0.22, 7, 9, 0.44, 0.15, "#f9f9f2");
  const entrance = label(scene, "ENTRANCE", 0, 0.09, 6.5, 2.2, true);
  entrance.rotation.x = -Math.PI / 2;
  const startMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.035, 24),
    new THREE.MeshBasicMaterial({ color: 0xdc7298 }),
  );
  startMarker.position.set(0, 0.1, 6);
  scene.add(startMarker);
  // Glass partition, with a walk-through opening.
  const glass = new THREE.MeshStandardMaterial({
    color: 0xc9ddd6,
    transparent: true,
    opacity: 0.28,
    roughness: 0.12,
    metalness: 0.1,
  });
  for (const x of [-6.5, -2.5]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.1, 0.08), glass);
    panel.position.set(x, 1.1, 0.8);
    scene.add(panel);
    for (const dx of [-1.75, 1.75])
      box(scene, x + dx, 1.1, 0.8, 0.05, 2.2, 0.08, "#7e8c83");
  }
  const roomLabel = label(scene, "STORAGE / 01", -4.4, 0.08, -5.8, 3.2);
  roomLabel.rotation.x = -Math.PI / 2;
  const labLabel = label(scene, "WORKSPACE / 02", 4.7, 0.08, 5.6, 3.5);
  labLabel.rotation.x = -Math.PI / 2;
  function plant(x: number, z: number) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.25, 0.6, 16),
      material("#c4c5ba"),
    );
    pot.position.set(x, 0.3, z);
    pot.castShadow = true;
    scene.add(pot);
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 8),
        material(i % 2 ? "#78947c" : "#4d7057"),
      );
      leaf.scale.set(0.7, 1.6, 0.7);
      leaf.position.set(
        x + Math.sin(i * 2) * 0.2,
        0.9 + i * 0.14,
        z + Math.cos(i * 2) * 0.2,
      );
      leaf.castShadow = true;
      scene.add(leaf);
    }
  }
  plant(-8.8, 5.7);
  plant(8.8, -5.7);
  plant(8.8, 5.7);

  const targets: THREE.Object3D[] = [];
  const boxTargets: THREE.Object3D[] = [];
  const packages = new Map<string, THREE.Group>();
  const boxOutlines = new Map<string, THREE.LineSegments>();
  const rings = new Map<string, THREE.Mesh>();
  const groups = new Map<string, THREE.Group>();
  for (const shelf of shelves) {
    const group = new THREE.Group();
    group.position.set(shelf.x, 0, shelf.z);
    group.rotation.y = THREE.MathUtils.degToRad(shelf.rotation);
    scene.add(group);
    groups.set(shelf.id, group);
    if (shelf.kind === "table") {
      box(group, 0, 1, 0, 2.6, 0.13, 1.3, "#c6b79d");
      for (const x of [-1.1, 1.1])
        for (const z of [-0.5, 0.5])
          box(group, x, 0.5, z, 0.08, 1, 0.08, "#52625a");
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
    for (const x of [-1.28, 1.28])
      for (const z of [-0.48, 0.48])
        box(group, x, top / 2, z, 0.07, top + 0.1, 0.07, "#52625a");
    for (let level = 0; level <= levels; level++)
      box(group, 0, 0.25 + level * 0.78, 0, 2.65, 0.08, 1.06, "#7b8c80");
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
      const packageMesh = box(
        packageGroup,
        0,
        0,
        0,
        0.48,
        0.48,
        0.7,
        full ? "#b4c3a8" : "#c4b49a",
      );
      packageMesh.userData = { shelfId: shelf.id, boxId: storage.id };
      boxTargets.push(packageMesh);
      const sticker = label(packageGroup, storage.name, 0, 0, 0.357, 0.43);
      sticker.userData = { shelfId: shelf.id, boxId: storage.id };
      boxTargets.push(sticker);
      box(packageGroup, 0, 0.244, 0, 0.07, 0.01, 0.7, "#a39680");
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
      grid.visible = false;
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
      2 * Math.atan(11 / (Math.max(1, distance) * camera.aspect)),
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
      controls.target.set(0, 0, 0);
      camera.position.set(
        ...((plan ? [0, 32, 0.01] : [22, 23, 27]) as [number, number, number]),
      );
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
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

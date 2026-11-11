"use client";

import { ItemTransferPanel } from "./item-transfer-panel";
import {
  transferItems,
  type ItemTransfer,
  type BoxAddress,
} from "@/lib/spatial/item-transfer";
import { ShelfArranger } from "./shelf-arranger";
import {
  resolveSlots,
  placeBox,
  copyEmptyBox,
  occupiedLevels,
} from "@/lib/spatial/box-placement";
import {
  shelfLevels,
  emptyShelfCopy,
  OFFICE_TABLES,
} from "@/lib/spatial/builder";
import {
  Trash2,
  Table2,
  Copy,
  Undo2,
  Layers,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Box,
  Boxes,
  Check,
  Crosshair,
  Map,
  Minus,
  Monitor,
  MousePointer2,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Upload,
  X,
  Route,
} from "lucide-react";
import { VerletLogo } from "@/components/ui/verlet-logo";
import {
  clampPlacement,
  isDeskId,
  isShelf,
  DESK_PREFIX,
  readLayout,
  type Layout,
  type SpatialShelf,
  type SpatialItem,
} from "@/lib/spatial/model";
import { readDraft, type SpatialDraft } from "@/lib/spatial/draft";
import type { createOffice } from "./office-scene";
import { FloorSketch } from "./floor-sketch";
import "./workspace.css";
import { saveDesks } from "@/app/(spatial)/space/actions";

import { BoxInspector } from "./box-inspector";
import { ScanPanel } from "./scan-panel";
import {
  WorkspaceTools,
  WorkspacePanels,
  MAP_TAB,
  type WorkspaceTab,
} from "./workspace-tools";

import {
  seedBoxes,
  readBoxes,
  type BoxMap,
  type StorageBox,
} from "@/lib/spatial/boxes";
import { canManageInventory, type Capable } from "@/lib/roles";
import {
  InventoryExplorer,
  LocationsExplorer,
  DirectionsPanel,
} from "./explore-panels";
import {
  findFloorRoute,
  officeObstacles,
  shelfApproach,
  OFFICE_ENTRANCE,
} from "@/lib/spatial/directions";
type Scene = ReturnType<typeof createOffice>;
export function SpatialWorkspace({
  shelves: initialShelves,
  userId,
  profile,
  catalog,
  desks = [],
  people = [],
}: {
  /** The floor's desks: where each stands and who sits there. */
  desks?: SpatialShelf[];
  /** People a desk can be given to; empty unless this person may assign desks. */
  people?: { id: string; name: string }[];
  shelves: SpatialShelf[];
  userId: string;
  profile: Capable | null;
  catalog: SpatialItem[];
}) {
  const [sidebarCompact, setSidebarCompact] = useState(false);
  useEffect(() => {
    // Restore the same expanded/compact interaction used by Ego's sidebar.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarCompact(
        localStorage.getItem("verlet-inventory-sidebar-compact") === "true",
      );
    } catch {}
  }, []);
  function toggleSidebar() {
    const next = !sidebarCompact;
    setSidebarCompact(next);
    try {
      localStorage.setItem("verlet-inventory-sidebar-compact", String(next));
    } catch {}
  }
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(MAP_TAB);
  const [visited, setVisited] = useState<WorkspaceTab[]>([]);
  const [routeTarget, setRouteTarget] = useState<string | null>(null);
  function switchTab(tab: WorkspaceTab) {
    setArranging(false);
    setPreviewTarget(null);
    engine.current?.isolate(null);
    setActiveTab(tab);
    setScan(tab.id === "scan");
    setEdit(false);
    if (tab.path)
      setVisited((v) => (v.some((t) => t.id === tab.id) ? v : [...v, tab]));
  }
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Scene | null>(null);
  const cameraState = useRef<ReturnType<Scene["snapshot"]> | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [layout, setLayout] = useState<Layout>({});
  const [extras, setExtras] = useState<SpatialShelf[]>([]);
  const [itemEdits, setItemEdits] = useState<SpatialDraft["items"]>({});
  const [boxMap, setBoxMap] = useState<BoxMap>({});
  // Desk id -> who sits there, for changes not yet saved.
  const [owners, setOwners] = useState<Record<string, string | null>>({});
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const previewReturn = useRef<ReturnType<Scene["snapshot"]> | null>(null);
  const [selectedBox, setSelectedBox] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [clipboard, setClipboard] = useState<
    | { kind: "object"; value: SpatialShelf }
    | { kind: "box"; value: StorageBox }
    | null
  >(null);
  const itemDropRef = useRef<(move: ItemTransfer, target: BoxAddress) => void>(
    () => {},
  );
  const boxMoveRef = useRef<(id: string, slot: number) => void>(() => {});
  const [builderTab, setBuilderTab] = useState<"add" | "objects">("add");
  const [hidden, setHidden] = useState<string[]>([]);
  const editRef = useRef(false);
  const moveRef = useRef<(id: string, x: number, z: number) => void>(() => {});
  const [history, setHistory] = useState<
    {
      layout: Layout;
      extras: SpatialShelf[];
      boxes: BoxMap;
      hidden: string[];
    }[]
  >([]);
  function checkpoint() {
    setHistory((h) => [
      ...h.slice(-29),
      { layout, extras, boxes: boxMap, hidden },
    ]);
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHidden(previous.hidden);
    setLayout(previous.layout);
    setExtras(previous.extras);
    setBoxMap(previous.boxes);
    setHistory((h) => h.slice(0, -1));
    setSaved(false);
  }
  useEffect(() => {
    editRef.current = edit;
  }, [edit]);
  const [plan, setPlan] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const objects = useMemo(
    () =>
      [
        ...initialShelves,
        ...OFFICE_TABLES,
        ...desks.map((d) =>
          d.id in owners
            ? {
                ...d,
                owner: owners[d.id],
                ownerName: people.find((p) => p.id === owners[d.id])?.name ?? null,
                mine: owners[d.id] === userId,
              }
            : d,
        ),
        ...extras,
      ]
        .filter((s) => !hidden.includes(s.id))
        .map((s) => {
          const boxes = resolveSlots(
            boxMap[s.id] ?? seedBoxes(s.id, itemEdits[s.id] ?? s.items),
          );
          return {
            ...s,
            ...layout[s.id],
            boxes,
            items: boxes.flatMap((b) => b.items),
          };
        }),
    [initialShelves, desks, owners, people, userId, extras, layout, itemEdits, boxMap, hidden],
  );
  const shelves = useMemo(
    () => objects.filter(isShelf),
    [objects],
  );
  const route = useMemo(() => {
    const destination = shelves.find((s) => s.id === routeTarget);
    return destination && !image
      ? findFloorRoute(
          OFFICE_ENTRANCE,
          shelfApproach(destination),
          officeObstacles(
            shelves,
            objects.filter((s) => s.kind === "table"),
            objects.filter((s) => s.kind === "desk"),
          ),
        )
      : null;
  }, [shelves, objects, routeTarget, image]);
  const allCatalog = useMemo(
    () =>
      Array.from(
        new globalThis.Map(
          [...catalog, ...shelves.flatMap((s) => s.items)].map((item) => [
            item.id,
            item,
          ]),
        ).values(),
      ),
    [catalog, shelves],
  );
  const active = objects.find((s) => s.id === selected) ?? null;
  const matches = shelves.flatMap<{ shelf: SpatialShelf; box?: StorageBox }>(
    (s) => {
      const q = query.toLowerCase();
      const boxes = s.boxes.filter((b) =>
        `${b.name} ${b.items.map((i) => `${i.name} ${i.type}`).join(" ")}`
          .toLowerCase()
          .includes(q),
      );
      return boxes.length
        ? boxes.map((b) => ({ shelf: s, box: b }))
        : s.name.toLowerCase().includes(q)
          ? [{ shelf: s, box: undefined }]
          : [];
    },
  );
  // v2: positions are on Verlet's floor (v1 layouts used the old room's grid).
  const storageKey = `verlet-spatial-v2:${userId}`;

  useEffect(() => {
    // Browser-only persistence is synchronized after hydration.
    try {
      // Only replace state that was actually saved: a new but empty object
      // would rebuild the whole 3D scene for nothing on every load.
      const saved = readLayout(localStorage.getItem(storageKey));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Object.keys(saved).length) setLayout(saved);
      const removed = JSON.parse(
        localStorage.getItem(`${storageKey}:hidden`) ?? "[]",
      );
      if (Array.isArray(removed) && removed.length)
        setHidden(removed.filter((id: unknown) => typeof id === "string"));
      const draft = readDraft(localStorage.getItem(`${storageKey}:draft`));
      if (draft.extras.length) setExtras(draft.extras);
      if (Object.keys(draft.items).length) setItemEdits(draft.items);
      const boxes = readBoxes(localStorage.getItem(`${storageKey}:boxes`));
      if (Object.keys(boxes).length) setBoxMap(boxes);
    } catch {
      /* Storage can be disabled. */
    }
  }, [storageKey]);
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  const selectionRef = useRef({
    selected,
    selectedBox,
    previewTarget,
    arranging,
  });
  useEffect(() => {
    selectionRef.current = { selected, selectedBox, previewTarget, arranging };
  }, [selected, selectedBox, previewTarget, arranging]);
  useEffect(() => {
    let cancelled = false;
    let instance: Scene | null = null;
    if (!host.current) return;
    // The external WebGL renderer is recreated when geometry changes.
    setReady(false);
    import("./office-scene")
      .then(({ createOffice }) => {
        if (cancelled || !host.current) return;
        instance = createOffice(host.current, objects, image, (id, boxId) => {
          if (editRef.current) {
            setBuilderTab("objects");
            setSelected(id);
            setSelectedBox(boxId ?? null);
            return;
          }
          const picked = objects.find((o) => o.id === id);
          if (picked?.kind === "desk" && !picked.locked) {
            // Your desk's tag: open the plan editor on it, ready to drag or turn.
            setArranging(false);
            setBuilderTab("objects");
            setRouteTarget(null);
            setSelected(id);
            setSelectedBox(null);
            setScan(false);
            setActiveTab(MAP_TAB);
            setEdit(true);
            setPlan(true);
          }
          if (!picked || !isShelf(picked)) return;
          setSelected(id);
          setSelectedBox(boxId ?? null);
          setScan(false);
          setActiveTab(MAP_TAB);
          setPlan(false);
          requestAnimationFrame(() => engine.current?.focus(id, boxId));
        });
        engine.current = instance;
        instance.itemDrop((move, target) => itemDropRef.current(move, target));
        instance.editing(editRef.current, (id, x, z) =>
          moveRef.current(id, x, z),
        );
        instance.arrange(
          editRef.current && selectionRef.current.arranging
            ? selectionRef.current.selected
            : null,
          (id, slot) => boxMoveRef.current(id, slot),
        );
        instance.route(routeRef.current?.points ?? []);
        instance.select(
          selectionRef.current.selected,
          selectionRef.current.selectedBox,
        );
        if (cameraState.current) instance.restore(cameraState.current);
        instance.isolate(selectionRef.current.previewTarget);
        setReady(true);
        setError("");
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "3D is unavailable in this browser. You can still inspect locations using the list.",
          );
      });
    return () => {
      cancelled = true;
      if (instance) cameraState.current = instance.snapshot();
      instance?.dispose();
      engine.current = null;
    };
  }, [objects, image]);
  useEffect(() => {
    engine.current?.select(selected, selectedBox);
  }, [selected, selectedBox, ready]);
  useEffect(() => {
    engine.current?.view(plan);
  }, [plan]);
  useEffect(() => {
    engine.current?.isolate(previewTarget);
  }, [previewTarget, ready]);
  function focusSelection(id: string, boxId?: string | null) {
    setPlan(false);
    requestAnimationFrame(() => engine.current?.focus(id, boxId));
  }
  function inspectSelection() {
    if (!active) return;
    const target = selectedBox ?? active.id;
    if (previewTarget === target) {
      setPreviewTarget(null);
      engine.current?.isolate(null);
      if (previewReturn.current) {
        const previous = previewReturn.current;
        setPlan(!previous.rotate);
        requestAnimationFrame(() => engine.current?.restore(previous));
      }
      return;
    }
    if (!previewTarget)
      previewReturn.current = engine.current?.snapshot() ?? null;
    setPreviewTarget(target);
    engine.current?.isolate(target);
    focusSelection(active.id, selectedBox);
  }

  function resetView(nextPlan = plan) {
    setPreviewTarget(null);
    engine.current?.isolate(null);
    setPlan(nextPlan);
    engine.current?.view(nextPlan);
  }
  useEffect(() => {
    engine.current?.route(route?.points ?? []);
  }, [route, ready]);
  function showDirections(id: string) {
    setRouteTarget(id);
    setSelected(id);
    if (id !== selected) setSelectedBox(null);
    setPlan(true);
    engine.current?.view(true);
    switchTab({ id: "directions", name: "Directions" });
  }

  useEffect(() => {
    moveRef.current = (id, x, z) => {
      checkpoint();
      setLayout((v) => ({
        ...v,
        [id]: clampPlacement({ ...objects.find((s) => s.id === id)!, x, z }, isDeskId(id)),
      }));
      setSelected(id);
      setBuilderTab("objects");
      setSelectedBox(null);
      setSaved(false);
    };
    engine.current?.editing(edit, (id, x, z) => moveRef.current(id, x, z));
  });
  function choose(id: string, boxId?: string) {
    if (edit) {
      setArranging(false);
      setBuilderTab("objects");
      setSelected(id);
      setSelectedBox(null);
      return;
    }
    setSelected(id);
    setSelectedBox(boxId ?? null);
    setScan(false);
    setActiveTab(MAP_TAB);
    focusSelection(id, boxId);
  }
  function findShelf(event: React.MouseEvent<HTMLButtonElement>) {
    const id = event.currentTarget.dataset.shelfId;
    if (id) {
      choose(id, event.currentTarget.dataset.boxId);
      setQuery("");
    }
  }
  function updatePlacement(patch: Partial<Layout[string]>) {
    if (!active) return;
    checkpoint();
    setLayout((value) => ({
      ...value,
      [active.id]: clampPlacement({ ...active, ...patch }, isDeskId(active.id)),
    }));
    setSaved(false);
  }
  const [savingDesks, setSavingDesks] = useState(false);
  const deskDirty = objects.some(
    (o) => o.kind === "desk" && !o.locked && (layout[o.id] || o.id in owners),
  );
  /** Desks are shared: their place and owner go to the server, not this device. */
  async function saveDeskChanges() {
    const changes = objects
      .filter((o) => o.kind === "desk" && !o.locked && (layout[o.id] || o.id in owners))
      .map((o) => ({
        id: o.id.slice(DESK_PREFIX.length),
        x: o.x,
        z: o.z,
        rotation: o.rotation,
        ...(o.id in owners ? { user_id: owners[o.id] } : {}),
      }));
    if (!changes.length) return;
    setSavingDesks(true);
    try {
      const result = await saveDesks(changes);
      setNotice(
        result.error
          ? `Desks were not all saved: ${result.error}`
          : `${result.saved === 1 ? "1 desk" : `${result.saved} desks`} saved for everyone. The rest of the plan is saved on this device.`,
      );
    } catch {
      setNotice("Could not reach the server, so desk changes are not saved yet. Try Save again.");
    } finally {
      setSavingDesks(false);
    }
  }
  function save() {
    try {
      // Desks are saved for everyone below, so they stay out of this device's plan.
      localStorage.setItem(
        storageKey,
        JSON.stringify(Object.fromEntries(Object.entries(layout).filter(([id]) => !isDeskId(id)))),
      );
      localStorage.setItem(`${storageKey}:hidden`, JSON.stringify(hidden));
      localStorage.setItem(
        `${storageKey}:draft`,
        JSON.stringify({ extras, items: itemEdits }),
      );
      localStorage.setItem(`${storageKey}:boxes`, JSON.stringify(boxMap));
      setSaved(true);
      setNotice("Saved on this device. Inventory records are unchanged.");
      void saveDeskChanges();
    } catch {
      setNotice(
        "Browser storage is full or unavailable. Your layout is still available in this session.",
      );
    }
  }
  function addShelf(levels = 3, kind: "shelf" | "table" = "shelf") {
    setArranging(false);
    setBuilderTab("objects");
    checkpoint();
    const id = `prototype-${crypto.randomUUID()}`;
    setExtras((v) => [
      ...v,
      {
        id,
        kind,
        name: `${kind === "table" ? "Table" : "Shelf"} ${v.length + 1}`,
        x: 3,
        z: 0,
        rotation: 0,
        levels,
        items: [],
        prototype: true,
      },
    ]);
    setSelected(id);
    setSelectedBox(null);
    setEdit(true);
    resetView(true);
    setSaved(false);
  }
  function updateBoxes(id: string, boxes: StorageBox[]) {
    setBoxMap((v) => ({ ...v, [id]: boxes }));
    setSaved(false);
  }
  function handleItemTransfer(move: ItemTransfer, target: BoxAddress | null) {
    try {
      const current = Object.fromEntries(shelves.map((s) => [s.id, s.boxes]));
      const next = transferItems(current, allCatalog, move, target);
      if (next === current) {
        setNotice("That item is already in this box.");
        return true;
      }
      checkpoint();
      setBoxMap((v) => ({ ...v, ...next }));
      setSaved(false);
      setNotice(
        `${move.quantity} ${move.quantity === 1 ? "unit" : "units"} ${target ? (move.source ? "moved" : "added") : "picked out"}. Use Undo item change to restore.`,
      );
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not move this item.",
      );
      return false;
    }
  }
  useEffect(() => {
    itemDropRef.current = (move, target) => {
      handleItemTransfer(move, target);
    };
  });
  function moveBox(id: string, slot: number) {
    if (!active) return;
    checkpoint();
    updateBoxes(active.id, placeBox(active.boxes, id, slot));
    setSelectedBox(id);
  }
  function addSingleBox(slot?: number) {
    if (!active || !isShelf(active)) return;
    checkpoint();
    const b: StorageBox = {
      id: crypto.randomUUID(),
      name: `Box ${active.boxes.length + 1}`,
      items: [],
      ...(slot === undefined ? {} : { slot }),
    };
    updateBoxes(active.id, resolveSlots([...active.boxes, b]));
    setSelectedBox(b.id);
  }
  function copySelection() {
    if (!active || active.kind === "desk") return;
    const b = arranging
      ? active.boxes.find((b) => b.id === selectedBox)
      : undefined;
    setClipboard(
      b
        ? { kind: "box", value: structuredClone(b) }
        : { kind: "object", value: structuredClone(active) },
    );
    setNotice(`${b?.name ?? active.name} copied. Paste creates an empty copy.`);
  }
  function pasteSelection() {
    if (!clipboard) return;
    if (clipboard.kind === "box") {
      if (!active || !isShelf(active)) {
        setNotice("Select a shelf to paste the box.");
        return;
      }
      checkpoint();
      const b = copyEmptyBox(clipboard.value, crypto.randomUUID());
      updateBoxes(active.id, resolveSlots([...active.boxes, b]));
      setSelectedBox(b.id);
      setArranging(true);
    } else {
      checkpoint();
      const copy = emptyShelfCopy(
        clipboard.value,
        `prototype-${crypto.randomUUID()}`,
      );
      setExtras((v) => [...v, copy]);
      setSelected(copy.id);
      setSelectedBox(null);
      setArranging(false);
      setBuilderTab("objects");
      setSaved(false);
    }
  }
  function arrangeBoxes() {
    setArranging(!arranging);
    setSelectedBox(null);
    if (!arranging && active) focusSelection(active.id);
  }
  useEffect(() => {
    boxMoveRef.current = moveBox;
    engine.current?.arrange(
      arranging && edit && active && isShelf(active)
        ? active.id
        : null,
      (id, slot) => boxMoveRef.current(id, slot),
    );
  });
  function removeObject() {
    if (!active || active.kind === "desk") return;
    checkpoint();
    setHidden((v) => [...v, active.id]);
    setSelected(null);
    setSelectedBox(null);
    setSaved(false);
    setNotice(
      "Removed from this plan. Inventory records are unchanged. Use Undo to restore.",
    );
  }
  async function loadPlan(file: File | undefined) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setNotice("Choose a PNG, JPG, or WebP floor plan under 5 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const tooLarge = bitmap.width > 8192 || bitmap.height > 8192;
      bitmap.close();
      if (tooLarge) {
        setNotice("Choose a plan no larger than 8192 pixels on either side.");
        return;
      }
    } catch {
      setNotice(
        "That file is not a readable image. Choose a PNG, JPG, or WebP plan.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(String(reader.result));
      setImageName(file.name);
      setPlan(true);
      setNotice(
        "Floor plan placed under the model. Use Edit plan to position shelves.",
      );
    };
    reader.onerror = () =>
      setNotice("The plan could not be opened. Try another image.");
    reader.readAsDataURL(file);
  }

  return (
    <div
      className="spatial-app"
      data-sidebar-compact={sidebarCompact}
      onKeyDownCapture={(e) => {
        e.currentTarget.dataset.keyboardMotion = "true";
        if (!edit || !(e.metaKey || e.ctrlKey) || e.altKey) return;
        const target = e.target as HTMLElement;
        if (target.closest("input,textarea,select,[contenteditable=true]"))
          return;
        if (e.key.toLowerCase() === "c" && active) {
          e.preventDefault();
          copySelection();
        }
        if (e.key.toLowerCase() === "v" && clipboard) {
          e.preventDefault();
          pasteSelection();
        }
      }}
      onPointerDownCapture={(e) => {
        e.currentTarget.dataset.keyboardMotion = "false";
      }}
    >
      <WorkspaceTools
        profile={profile}
        active={activeTab}
        onChange={switchTab}
        compact={sidebarCompact}
        onToggle={toggleSidebar}
      />
      <div className="spatial-main">
        <header className="spatial-header">
          <div className="spatial-identity">
            <VerletLogo className="size-6" />
            <div>
              <h1>Inventory</h1>
              <span className="spatial-floor-label">
                Verlet floor · {shelves.length}{" "}
                {shelves.length === 1 ? "shelf" : "shelves"}
              </span>
            </div>
          </div>
          <div
            className="spatial-header-actions"
            style={{
              visibility: activeTab.id !== "map" ? "hidden" : "visible",
            }}
          >
            {edit && (
              <>
                <button
                  className="spatial-button"
                  aria-label="Import floor plan"
                  onClick={() => upload.current?.click()}
                >
                  <Upload />
                  <span>Import plan</span>
                </button>
                <button
                  className="spatial-button"
                  aria-label="Add block"
                  onClick={() => {
                    setBuilderTab("add");
                    setSelected(null);
                  }}
                >
                  <Plus />
                  <span>Add block</span>
                </button>
              </>
            )}
            <button
              aria-label={edit ? "Done" : "Edit plan"}
              className={`spatial-button ${edit ? "active" : ""}`}
              onClick={() => {
                setArranging(false);
                setBuilderTab("add");
                setEdit(!edit);
                setRouteTarget(null);
                setSelected(null);
                setSelectedBox(null);
                setScan(false);
                resetView(true);
              }}
            >
              {edit ? <Check /> : <Move />}
              <span>{edit ? "Done" : "Edit plan"}</span>
            </button>
          </div>
          <input
            ref={upload}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Upload floor plan"
            onChange={(e) => {
              void loadPlan(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </header>
        <div
          className="spatial-content"
          data-tools-open={activeTab.id !== "map"}
          data-inspector-open={activeTab.id === "map" && !!(active || edit)}
        >
          <section
            className="spatial-stage"
            id="workspace-panel-map"
            role="tabpanel"
            aria-labelledby="workspace-tab-map"
            aria-label="Office floor plan"
          >
            <div className="spatial-search">
              <Search size={17} />
              <input
                aria-label="Find items or locations on the map"
                placeholder="Find an item or a place…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={15} />
                </button>
              )}
            </div>
            {query && (
              <div className="spatial-search-results">
                {matches.length ? (
                  matches.map(({ shelf: s, box: b }) => (
                    <button
                      key={`${s.id}:${b?.id ?? "shelf"}`}
                      data-shelf-id={s.id}
                      data-box-id={b?.id}
                      onClick={findShelf}
                    >
                      <Box size={16} />
                      <span>
                        {b?.name ?? s.name}
                        <small>
                          {b
                            ? `${s.name} · ${b.items.reduce((n, i) => n + i.quantity, 0)} units`
                            : "Storage location"}
                        </small>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))
                ) : (
                  <p>
                    No placed items or boxes match. Check Inventory for unplaced
                    items.
                  </p>
                )}
              </div>
            )}
            <div ref={host} className="spatial-canvas" />
            {!ready && !error && (
              <div className="spatial-loading" role="status">
                <FloorSketch shelves={objects} />
                <p className="spatial-loading-note">
                  Building your space
                  <span />
                </p>
              </div>
            )}
            {error && (
              <div className="spatial-scene-error" role="alert">
                {error}
              </div>
            )}

            <div className="spatial-view-controls">
              <button aria-pressed={!plan} onClick={() => resetView(false)}>
                <Box size={14} />
                3D
              </button>
              <button aria-pressed={plan} onClick={() => resetView(true)}>
                <Map size={14} />
                Plan
              </button>
            </div>
            <div className="spatial-camera-controls">
              <button
                aria-label="Zoom in"
                onClick={() => engine.current?.zoom(0.82)}
              >
                <Plus />
              </button>
              <button
                aria-label="Zoom out"
                onClick={() => engine.current?.zoom(1.2)}
              >
                <Minus />
              </button>
              <span />
              <button
                aria-label="Orbit left"
                disabled={plan}
                onClick={() => engine.current?.orbit(Math.PI / 4)}
              >
                <RotateCcw />
              </button>
              <button
                aria-label="Orbit right"
                disabled={plan}
                onClick={() => engine.current?.orbit(-Math.PI / 4)}
              >
                <RotateCw />
              </button>
              <span />
              <button aria-label="Reset view" onClick={() => resetView()}>
                <RotateCcw />
              </button>
            </div>
            <div className="spatial-scene-footer">
              <span>
                <MousePointer2 size={13} />
                {edit
                  ? "Drag shelf to move · Snaps to 0.5 m"
                  : "Drag to orbit · Scroll / pinch to zoom"}
              </span>
              <span>Sample office · Local stock</span>
            </div>
            {imageName && (
              <div className="spatial-plan-chip">
                <Map size={13} />
                {imageName}
                <button
                  aria-label="Remove floor plan"
                  onClick={() => {
                    setImage(null);
                    setImageName("");
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            )}
          </section>
          {activeTab.id === "map" && (active || edit) && (
            <aside
              className="spatial-inspector"
              aria-label={
                scan ? "Scan inventory" : edit ? "Plan editor" : "Shelf details"
              }
            >
              <div className="spatial-panel-heading">
                <span>
                  {scan ? "Scan & place" : edit ? "Edit plan" : "Shelf details"}
                </span>
                <button
                  aria-label="Close details"
                  onClick={() => {
                    setSelected(null);
                    setPreviewTarget(null);
                    engine.current?.isolate(null);
                    engine.current?.view(plan);
                    setEdit(false);
                    setScan(false);
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              {edit && (
                <>
                  <div
                    className="spatial-builder-tabs"
                    role="tablist"
                    aria-label="Plan editor tools"
                  >
                    <button
                      role="tab"
                      aria-selected={builderTab === "add"}
                      onClick={() => setBuilderTab("add")}
                    >
                      <Plus size={16} />
                      Add
                    </button>
                    <button
                      role="tab"
                      aria-selected={builderTab === "objects"}
                      onClick={() => setBuilderTab("objects")}
                    >
                      <Layers size={16} />
                      Objects
                    </button>
                    <button
                      title="Paste on canvas (⌘V / Ctrl+V)"
                      aria-label="Paste on canvas"
                      disabled={!clipboard}
                      onClick={pasteSelection}
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      aria-label="Undo last edit"
                      disabled={!history.length}
                      onClick={undo}
                    >
                      <Undo2 size={16} />
                    </button>
                  </div>
                  {builderTab === "add" ? (
                    <div className="spatial-builder">
                      <p className="spatial-edit-hint">
                        Choose a block, then drag it into place.
                      </p>
                      <div className="spatial-blocks">
                        {[
                          { name: "Low", levels: 1 },
                          { name: "Standard", levels: 3 },
                          { name: "Tall", levels: 5 },
                        ].map((block) => (
                          <button
                            key={block.name}
                            onClick={() => addShelf(block.levels)}
                            aria-label={`Add ${block.name.toLowerCase()} shelf`}
                          >
                            <span className="spatial-block-preview">
                              {Array.from({ length: block.levels }, (_, i) => (
                                <i key={i} />
                              ))}
                            </span>
                            <strong>{block.name}</strong>
                            <small>{block.levels} levels</small>
                          </button>
                        ))}
                        <button
                          onClick={() => addShelf(1, "table")}
                          aria-label="Add table"
                        >
                          <Table2 size={36} />
                          <strong>Table</strong>
                          <small>Work surface</small>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="spatial-object-list">
                      {objects
                        .filter((o) => !o.locked)
                        .map((o) => (
                          <button
                            key={o.id}
                            aria-pressed={selected === o.id}
                            onClick={() => choose(o.id)}
                          >
                            {o.kind === "desk" ? (
                              <Monitor size={16} />
                            ) : o.kind === "table" ? (
                              <Table2 size={16} />
                            ) : (
                              <Boxes size={16} />
                            )}
                            <span>
                              {o.name}
                              {o.kind === "desk" && o.ownerName ? (
                                <small> · {o.mine ? "you" : o.ownerName}</small>
                              ) : null}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </>
              )}
              {active && (!edit || builderTab === "objects") ? (
                <section
                  className="spatial-selection"
                  aria-label="Selected location"
                >
                  <div className="spatial-selection-heading">
                    <div>
                      <h3>{active.name}</h3>
                    </div>
                    <button
                      title={selectedBox ? "Focus on box" : "Focus on shelf"}
                      aria-label={
                        selectedBox
                          ? "Focus on selected box"
                          : "Focus on selected shelf"
                      }
                      onClick={() => focusSelection(active.id, selectedBox)}
                    >
                      <Crosshair size={18} />
                    </button>
                  </div>
                  {previewTarget &&
                    previewTarget !== (selectedBox ?? active.id) && (
                      <button
                        className="spatial-button spatial-inspect-box"
                        onClick={() => {
                          setPreviewTarget(null);
                          engine.current?.isolate(null);
                          if (previewReturn.current) {
                            const previous = previewReturn.current;
                            setPlan(!previous.rotate);
                            requestAnimationFrame(() =>
                              engine.current?.restore(previous),
                            );
                          }
                        }}
                      >
                        Back to room view
                      </button>
                    )}
                  {active.kind === "desk" && (
                    <p className="spatial-desk-owner">
                      {active.mine
                        ? "This is your desk."
                        : active.ownerName
                          ? `${active.ownerName} sits here.`
                          : "Nobody sits here yet."}
                    </p>
                  )}
                  {!selectedBox && active.kind !== "desk" && (
                    <button
                      className="spatial-button spatial-inspect-box"
                      aria-pressed={previewTarget === active.id}
                      onClick={inspectSelection}
                    >
                      <Crosshair size={16} />
                      {previewTarget === active.id
                        ? "Back to room"
                        : "Preview shelf"}
                    </button>
                  )}
                  {!edit && active.kind !== "desk" && (
                    <button
                      className="spatial-button spatial-directions-button"
                      onClick={() => showDirections(active.id)}
                    >
                      <Route size={15} />
                      Directions from entrance
                    </button>
                  )}
                  {edit ? (
                    <div className="spatial-edit-controls spatial-direct-editor">
                      <div className="spatial-builder-actions">
                        <button
                          className="spatial-button"
                          onClick={() =>
                            updatePlacement({ rotation: active.rotation + 90 })
                          }
                        >
                          <RotateCw size={16} />
                          {active.kind === "desk" ? "Turn 90°" : "Rotate"}
                        </button>
                        {active.kind !== "desk" && (
                          <>
                            <button
                              className="spatial-button"
                              onClick={copySelection}
                            >
                              <Copy size={16} />
                              {arranging && selectedBox ? "Copy box" : "Copy"}
                            </button>
                            <button
                              className="spatial-button"
                              onClick={removeObject}
                            >
                              <Trash2 size={16} />
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                      {active.kind === "desk" && people.length > 0 && (
                        <label>
                          Who sits here
                          <select
                            aria-label={`Who sits at ${active.name}`}
                            value={active.owner ?? ""}
                            onChange={(e) => {
                              setOwners((v) => ({ ...v, [active.id]: e.target.value || null }));
                              setSaved(false);
                            }}
                          >
                            <option value="">Nobody</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <p className="spatial-edit-hint">
                        {arranging ? (
                          "Drag boxes in 3D or use the shelf grid below."
                        ) : (
                          <>
                            Drag the whole{" "}
                            {active.kind === "desk" ? "desk" : active.kind === "table" ? "table" : "shelf"} on the
                            canvas. Snaps to 0.5 m.
                          </>
                        )}
                      </p>
                      <div className="spatial-builder-actions">
                        {[
                          { name: "left", x: -0.5, z: 0, Icon: ArrowLeft },
                          { name: "forward", x: 0, z: -0.5, Icon: ArrowUp },
                          { name: "back", x: 0, z: 0.5, Icon: ArrowDown },
                          { name: "right", x: 0.5, z: 0, Icon: ArrowRight },
                        ].map(({ name, x, z, Icon }) => (
                          <button
                            key={name}
                            className="spatial-button"
                            aria-label={`Move ${active.kind === "desk" ? "desk" : "shelf"} ${name}`}
                            onClick={() =>
                              updatePlacement({
                                x: active.x + x,
                                z: active.z + z,
                              })
                            }
                          >
                            <Icon size={16} />
                          </button>
                        ))}
                      </div>
                      <output className="spatial-position">
                        {active.x.toFixed(1)} m across · {active.z.toFixed(1)} m
                        deep · {active.rotation}°
                      </output>
                      {active.prototype && (
                        <label>
                          Name
                          <input
                            aria-label="Object name"
                            value={active.name}
                            onChange={(e) => {
                              checkpoint();
                              setExtras((v) =>
                                v.map((s) =>
                                  s.id === active.id
                                    ? {
                                        ...s,
                                        name: e.target.value.slice(0, 80),
                                      }
                                    : s,
                                ),
                              );
                              setSaved(false);
                            }}
                          />
                        </label>
                      )}
                      {isShelf(active) && (
                        <>
                          <label>
                            Levels{" "}
                            <span>
                              {Math.max(
                                shelfLevels(active.levels, active.boxes.length),
                                occupiedLevels(active.boxes),
                              )}
                            </span>
                            <input
                              aria-label="Shelf levels"
                              type="range"
                              min={Math.max(1, occupiedLevels(active.boxes))}
                              max={Math.max(6, occupiedLevels(active.boxes))}
                              value={Math.max(
                                shelfLevels(active.levels, active.boxes.length),
                                occupiedLevels(active.boxes),
                              )}
                              onChange={(e) =>
                                updatePlacement({
                                  levels: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <div className="spatial-builder-actions">
                            <button
                              className="spatial-button"
                              aria-pressed={arranging}
                              onClick={arrangeBoxes}
                            >
                              <Move size={16} />
                              {arranging ? "Move shelf" : "Arrange boxes"}
                            </button>
                            <button
                              className="spatial-button"
                              onClick={() => {
                                setArranging(true);
                                addSingleBox();
                                focusSelection(active.id);
                              }}
                            >
                              <Plus size={16} />
                              Add box
                            </button>
                          </div>
                          {arranging && (
                            <>
                              <ShelfArranger
                                boxes={active.boxes}
                                levels={Math.max(
                                  shelfLevels(
                                    active.levels,
                                    active.boxes.length,
                                  ),
                                  occupiedLevels(active.boxes),
                                )}
                                selected={selectedBox}
                                onSelect={setSelectedBox}
                                onPlace={moveBox}
                                onAdd={addSingleBox}
                              />
                              {selectedBox && (
                                <button
                                  className="spatial-button"
                                  onClick={() => setSelectedBox(null)}
                                >
                                  Clear box selection
                                </button>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <BoxInspector
                        key={`${active.id}:${selectedBox ?? "shelf"}`}
                        boxes={active.boxes}
                        selected={selectedBox}
                        onSelect={(id) => choose(active.id, id ?? undefined)}
                        onChange={(boxes) => updateBoxes(active.id, boxes)}
                        catalog={catalog}
                        inspecting={
                          previewTarget === selectedBox && !!selectedBox
                        }
                        onInspect={inspectSelection}
                      />
                      <ItemTransferPanel
                        shelves={shelves}
                        catalog={allCatalog}
                        source={
                          selectedBox
                            ? { shelfId: active.id, boxId: selectedBox }
                            : null
                        }
                        onTransfer={handleItemTransfer}
                        onUndo={undo}
                        canUndo={history.length > 0}
                      />
                    </>
                  )}
                </section>
              ) : null}
              {(edit || active) && (
                <button className="spatial-save" onClick={save} disabled={savingDesks}>
                  <Check size={16} />{" "}
                  {savingDesks ? "Saving…" : saved ? "Saved" : deskDirty ? "Save" : "Save locally"}
                </button>
              )}
              <p className="spatial-local-note">
                {desks.some((d) => !d.locked)
                  ? "Desks save for everyone. Other plan changes save on this device only."
                  : "Prototype changes save on this device only."}
              </p>
            </aside>
          )}
          <WorkspacePanels
            active={activeTab}
            visited={visited}
            onMap={() => switchTab(MAP_TAB)}
            onBack={() =>
              switchTab(
                activeTab.id === "catalog"
                  ? { id: "inventory", name: "Inventory" }
                  : { id: "locations", name: "Locations" },
              )
            }
            content={
              activeTab.id === "scan" ? (
                <ScanPanel
                  shelves={shelves}
                  catalog={allCatalog}
                  onBoxes={updateBoxes}
                  onChoose={choose}
                />
              ) : activeTab.id === "inventory" ? (
                <InventoryExplorer
                  catalog={allCatalog}
                  shelves={shelves}
                  onChoose={choose}
                  onManage={
                    canManageInventory(profile)
                      ? () =>
                          switchTab({
                            id: "catalog",
                            name: "Catalog editor",
                            path: "/items",
                          })
                      : undefined
                  }
                />
              ) : activeTab.id === "locations" ? (
                <LocationsExplorer
                  shelves={shelves}
                  onChoose={choose}
                  onManage={
                    canManageInventory(profile)
                      ? () =>
                          switchTab({
                            id: "location-editor",
                            name: "Manage locations",
                            path: "/locations",
                          })
                      : undefined
                  }
                />
              ) : activeTab.id === "directions" ? (
                <DirectionsPanel
                  boxLabel={
                    shelves
                      .find((s) => s.id === routeTarget)
                      ?.boxes.find((b) => b.id === selectedBox)?.name
                  }
                  key={routeTarget ?? "choose"}
                  shelves={shelves}
                  target={routeTarget}
                  route={route}
                  disabled={!!image}
                  onRoute={showDirections}
                  onClear={() => setRouteTarget(null)}
                />
              ) : null
            }
          />
        </div>
        {notice && (
          <div className="spatial-notice" role="status">
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

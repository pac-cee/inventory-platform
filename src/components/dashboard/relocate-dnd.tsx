"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { relocateStock } from "@/app/(app)/locations/actions";

// Carries the dragged item ids (JSON array) from an "items here" row to a
// location row. A single drag and a multi-item drag use the same payload shape.
const MIME = "text/item-ids";

interface SelectionCtx {
  selected: ReadonlySet<string>;
  toggle: (itemId: string) => void;
  clear: () => void;
  setDragging: (on: boolean) => void;
}

const Ctx = createContext<SelectionCtx | null>(null);

// How close to the top/bottom edge (px) starts auto-scrolling, and the fastest
// scroll step per frame at the very edge.
const SCROLL_EDGE = 110;
const SCROLL_MAX = 22;

/**
 * Holds which items are ticked on this page. Wrap the panels that contain both
 * the item rows and the drop targets — a server-rendered tree can sit inside.
 *
 * Also auto-scrolls the page while a drag is in progress: a native HTML5 drag
 * doesn't scroll the window, so a sub-location below the fold was unreachable —
 * you had to drop the item, scroll, and start again. Holding the drag near the
 * top or bottom edge now pans the page toward it, faster the closer you get.
 */
export function RelocateSelection({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [dragging, setDragging] = useState(false);

  const toggle = useCallback((itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(itemId)) next.add(itemId);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set<string>()), []);

  useEffect(() => {
    if (!dragging) return;
    let speed = 0;
    let frame = 0;

    // `dragover` is the only event that reports the pointer during a drag.
    const onDragOver = (e: DragEvent) => {
      const h = window.innerHeight;
      const y = e.clientY;
      if (y < SCROLL_EDGE) speed = -SCROLL_MAX * (1 - y / SCROLL_EDGE);
      else if (y > h - SCROLL_EDGE) speed = SCROLL_MAX * (1 - (h - y) / SCROLL_EDGE);
      else speed = 0;
    };
    const step = () => {
      if (speed !== 0) window.scrollBy(0, speed);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    window.addEventListener("dragover", onDragOver);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [dragging]);

  const value = useMemo(
    () => ({ selected, toggle, clear, setDragging }),
    [selected, toggle, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useSelection(): SelectionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Wrap the page in <RelocateSelection> to use relocate drag-and-drop.");
  return ctx;
}

/** "3 of 8 selected · Clear" — the header hint above the item list. */
export function SelectionBar({ total }: { total: number }) {
  const { selected, clear } = useSelection();
  if (selected.size === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Tick items to move several at once, or drag one on its own
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-fg">
        {selected.size} of {total} selected
      </span>
      <button
        type="button"
        onClick={clear}
        className="text-muted-foreground underline hover:text-fg"
      >
        Clear
      </button>
    </span>
  );
}

/**
 * An item row: a tick box to include it in a batch, plus drag-to-move.
 *
 * Dragging a ticked row drags the whole selection; dragging an unticked row
 * moves just that one and leaves the selection alone, so the original
 * single-item gesture is unchanged. The inner link should set
 * `draggable={false}` so this wrapper's drag wins over the anchor's.
 */
export function DraggableItem({ itemId, children }: { itemId: string; children: ReactNode }) {
  const { selected, toggle, setDragging } = useSelection();
  const isSelected = selected.has(itemId);

  return (
    <div
      draggable
      onDragStart={(e) => {
        const ids = isSelected ? [...selected] : [itemId];
        e.dataTransfer.setData(MIME, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={
        "flex cursor-grab items-center gap-2 pl-4 transition-colors active:cursor-grabbing " +
        (isSelected ? "bg-highlight/5" : "")
      }
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => toggle(itemId)}
        aria-label="Select for moving"
        className="h-4 w-4 flex-shrink-0 accent-highlight"
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A location row that accepts dropped items and relocates their stock here —
 * one item, or a whole ticked batch in a single drop.
 */
export function DropSubLocation({
  fromLocationId,
  toLocationId,
  children,
}: {
  fromLocationId: string;
  toLocationId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { clear, setDragging } = useSelection();
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        setDragging(false);
        let itemIds: string[] = [];
        try {
          itemIds = JSON.parse(e.dataTransfer.getData(MIME) || "[]") as string[];
        } catch {
          itemIds = [];
        }
        if (itemIds.length === 0) return;
        setError(null);
        start(async () => {
          const res = await relocateStock(itemIds, fromLocationId, toLocationId);
          if (res?.error) setError(res.error);
          else {
            clear();
            router.refresh();
          }
        });
      }}
      className={
        "transition-colors " +
        (over
          ? "bg-highlight/10 ring-1 ring-inset ring-highlight/50"
          : pending
            ? "opacity-60"
            : "")
      }
    >
      {children}
      {error ? <p className="px-5 pb-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

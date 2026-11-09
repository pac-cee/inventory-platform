"use client";
import styles from "./item-transfer-panel.module.css";
import { useState } from "react";
import { GripVertical, PackagePlus, ArrowUpRight, Undo2 } from "lucide-react";
import {
  ITEM_DRAG_TYPE,
  type ItemTransfer,
  type BoxAddress,
} from "@/lib/spatial/item-transfer";
import type { SpatialShelf, SpatialItem } from "@/lib/spatial/model";
export function ItemTransferPanel({
  shelves,
  catalog,
  source,
  onTransfer,
  onUndo,
  canUndo,
}: {
  shelves: SpatialShelf[];
  catalog: SpatialItem[];
  source: BoxAddress | null;
  onTransfer: (move: ItemTransfer, target: BoxAddress | null) => boolean;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [mode, setMode] = useState<"add" | "move">("add");
  const [quantity, setQuantity] = useState(1);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const sourceBox = source
    ? shelves
        .find((s) => s.id === source.shelfId)
        ?.boxes?.find((b) => b.id === source.boxId)
    : null;
  const items = (mode === "add" ? catalog : (sourceBox?.items ?? [])).filter(
    (i) => `${i.name} ${i.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  const payload = (itemId: string): ItemTransfer => ({
    itemId,
    quantity,
    ...(mode === "move" && source ? { source } : {}),
  });
  function drop(e: React.DragEvent, target: BoxAddress | null) {
    e.preventDefault();
    try {
      onTransfer(JSON.parse(e.dataTransfer.getData(ITEM_DRAG_TYPE)), target);
    } catch {
      /* Ignore unrelated external drags. */
    }
  }
  return (
    <details className={styles.panel} open>
      <summary>
        <PackagePlus size={16} />
        Add, move or pick items
      </summary>
      <div className={styles.body}>
        <div className={styles.tabs}>
          <button
            aria-pressed={mode === "add"}
            onClick={() => {
              setMode("add");
              setSelected(null);
            }}
          >
            Add stock
          </button>
          <button
            aria-pressed={mode === "move"}
            disabled={!sourceBox}
            onClick={() => {
              setMode("move");
              setSelected(null);
            }}
          >
            From this box
          </button>
          <button
            aria-label="Undo item change"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 size={15} />
          </button>
        </div>
        <label>
          Quantity to handle
          <input
            aria-label="Quantity to handle"
            type="number"
            min="1"
            max="1000000"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <input
          aria-label="Find item to handle"
          placeholder="Find an item…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p>
          {mode === "add"
            ? "Add new stock from the catalogue."
            : "Move or pick existing stock from this box."}{" "}
          Drag an item onto a box, or tap an item then its destination.
        </p>
        <div className={styles.items}>
          {items.map((i) => (
            <button
              key={i.id}
              draggable
              aria-pressed={selected === i.id}
              onClick={() => setSelected(i.id)}
              onDragStart={(e) => {
                setSelected(i.id);
                e.dataTransfer.setData(
                  ITEM_DRAG_TYPE,
                  JSON.stringify(payload(i.id)),
                );
                e.dataTransfer.effectAllowed = mode === "add" ? "copy" : "move";
              }}
            >
              <GripVertical size={15} />
              <span>
                {i.name}
                <small>
                  {mode === "move" ? `${i.quantity} available` : i.type}
                </small>
              </span>
            </button>
          ))}
        </div>
        {!items.length && <p>No matching items.</p>}
        <div className={styles.destinations}>
          {shelves
            .filter((s) => s.boxes?.length)
            .map((s) => (
              <div key={s.id}>
                <small>{s.name}</small>
                <div>
                  {s.boxes!.map((b) => (
                    <button
                      key={b.id}
                      aria-label={`Place items in ${s.name}, ${b.name}`}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes(ITEM_DRAG_TYPE))
                          e.preventDefault();
                      }}
                      onDrop={(e) => drop(e, { shelfId: s.id, boxId: b.id })}
                      onClick={() => {
                        if (selected)
                          onTransfer(payload(selected), {
                            shelfId: s.id,
                            boxId: b.id,
                          });
                      }}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
        {mode === "move" && (
          <>
            <button
              className={styles.pick}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(ITEM_DRAG_TYPE))
                  e.preventDefault();
              }}
              onDrop={(e) => drop(e, null)}
              onClick={() => {
                if (selected && mode === "move")
                  onTransfer(payload(selected), null);
              }}
            >
              <ArrowUpRight size={17} />
              Pick out {quantity} {quantity === 1 ? "unit" : "units"}
            </button>
            <p>
              Pick out reduces stock in the source box. Changes are local and
              undoable.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

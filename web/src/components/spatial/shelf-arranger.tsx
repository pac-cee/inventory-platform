"use client";
import { resolveSlots } from "@/lib/spatial/box-placement";
import type { StorageBox } from "@/lib/spatial/boxes";
export function ShelfArranger({
  boxes,
  levels,
  selected,
  onSelect,
  onPlace,
  onAdd,
}: {
  boxes: StorageBox[];
  levels: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onPlace: (id: string, slot: number) => void;
  onAdd: (slot: number) => void;
}) {
  const placed = resolveSlots(boxes);
  return (
    <div className="shelf-arranger">
      <p>
        Select a box, then tap a position. Drag to move; occupied positions
        swap.
      </p>
      {Array.from({ length: levels }, (_, row) => levels - row - 1).map(
        (level) => (
          <div key={level}>
            <small>Level {level + 1}</small>
            <div className="shelf-slot-row">
              {[0, 1, 2, 3].map((col) => {
                const slot = level * 4 + col,
                  b = placed.find((b) => b.slot === slot);
                return (
                  <button
                    key={slot}
                    draggable={!!b}
                    aria-pressed={!!b && selected === b.id}
                    aria-label={`Level ${level + 1}, position ${col + 1}${b ? `: ${b.name}` : ": empty"}`}
                    onDragStart={(e) => {
                      if (b) {
                        onSelect(b.id);
                        e.dataTransfer.setData(
                          "application/x-inventory-box",
                          b.id,
                        );
                        e.dataTransfer.effectAllowed = "move";
                      }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData(
                        "application/x-inventory-box",
                      );
                      if (placed.some((b) => b.id === id)) onPlace(id, slot);
                    }}
                    onClick={() => {
                      if (selected && selected !== b?.id)
                        onPlace(selected, slot);
                      else if (b) onSelect(b.id);
                      else onAdd(slot);
                    }}
                  >
                    <span>{b?.name ?? "+"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

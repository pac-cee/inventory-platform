"use client";
import { useState } from "react";
import {
  ArrowLeft,
  Box,
  Plus,
  QrCode,
  Minus,
  Pencil,
  Check,
  Orbit,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { StorageBox } from "@/lib/spatial/boxes";
import { putInBox } from "@/lib/spatial/boxes";
import type { SpatialItem } from "@/lib/spatial/model";
import { changeQuantity } from "@/lib/spatial/draft";

export function BoxInspector({
  boxes,
  selected,
  onSelect,
  onChange,
  catalog,
  inspecting,
  onInspect,
}: {
  inspecting: boolean;
  onInspect: () => void;
  boxes: StorageBox[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (boxes: StorageBox[]) => void;
  catalog: SpatialItem[];
}) {
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [qr, setQr] = useState(false);
  const [error, setError] = useState("");
  const box = boxes.find((b) => b.id === selected);
  function update(next: StorageBox) {
    onChange(boxes.map((b) => (b.id === next.id ? next : b)));
  }
  function addBox(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("boxLabel")).trim();
    if (!name) return;
    const next = { id: crypto.randomUUID(), name, items: [] };
    onChange([...boxes, next]);
    onSelect(next.id);
    setRenaming(true);
    setAdding(false);
  }
  function addItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!box) return;
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name")).trim();
    const item = catalog.find((i) => i.name === name) ?? {
      id: `draft-${crypto.randomUUID()}`,
      name,
      type: "Item",
      quantity: 0,
      capacity: 0,
    };
    try {
      onChange(putInBox(boxes, box.id, item, Number(data.get("quantity"))));
      setAdding(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add item.");
    }
  }
  if (!box)
    return (
      <div className="spatial-box-browser">
        <div className="spatial-section-label">
          <span>Boxes</span>
          <span>{boxes.length}</span>
        </div>
        <div className="spatial-box-grid">
          {boxes.map((b, i) => (
            <button
              key={b.id}
              onClick={() => {
                onSelect(b.id);
                setAdding(false);
                setQr(false);
                setRenaming(false);
              }}
            >
              <span
                className={`spatial-box-art ${b.items.some((i) => i.quantity > 0) ? "stocked" : ""}`}
              >
                <Box size={23} />
                <small>{String(i + 1).padStart(2, "0")}</small>
              </span>
              <strong>{b.name}</strong>
              <small>
                {b.items.reduce((n, i) => n + i.quantity, 0)} units ·{" "}
                {b.items.length} items
              </small>
            </button>
          ))}
        </div>
        {!boxes.length && (
          <p className="spatial-edit-hint">
            An empty shelf. Add a box, name it, then fill it.
          </p>
        )}
        <>
          {creating ? (
            <form className="spatial-add-form" onSubmit={addBox}>
              <label>
                New box label
                <input
                  name="boxLabel"
                  required
                  maxLength={60}
                  placeholder="e.g. Sensors · A01"
                />
              </label>
              <button className="spatial-button">Create box</button>
              <button
                type="button"
                className="spatial-remove"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              className="spatial-button spatial-add-item"
              onClick={() => setCreating(true)}
            >
              <Plus />
              Add box
            </button>
          )}
        </>
      </div>
    );
  return (
    <div className="spatial-box-details">
      <button className="spatial-back" onClick={() => onSelect(null)}>
        <ArrowLeft size={14} />
        All boxes
      </button>
      {renaming ? (
        <form
          className="spatial-inline-name"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(
              new FormData(e.currentTarget).get("label"),
            ).trim();
            if (name) {
              update({ ...box, name });
              setRenaming(false);
            }
          }}
        >
          <label>
            Box label
            <input
              name="label"
              defaultValue={box.name}
              required
              maxLength={60}
            />
          </label>
          <button aria-label="Save box label">
            <Check size={17} />
          </button>
        </form>
      ) : (
        <div className="spatial-box-name">
          <Box size={20} />
          <h4>{box.name}</h4>
          <button aria-label="Rename box" onClick={() => setRenaming(true)}>
            <Pencil size={15} />
          </button>
          <button aria-label="Show box QR label" onClick={() => setQr(!qr)}>
            <QrCode size={17} />
          </button>
        </div>
      )}
      <button
        className="spatial-button spatial-inspect-box"
        onClick={onInspect}
        aria-pressed={inspecting}
      >
        <Orbit size={16} />
        {inspecting ? "Back to shelf" : "Inspect box · 360°"}
      </button>
      {inspecting && (
        <p className="spatial-local-note">
          Drag to turn · Scroll or pinch to zoom · Right-drag to pan
        </p>
      )}
      {qr && (
        <div className="spatial-qr-label">
          <QRCodeSVG
            value={`inventory:spatial-box:${box.id}`}
            size={132}
            marginSize={2}
          />
          <strong>{box.name}</strong>
          <small>Scan to find this box on this device.</small>
          <button
            onClick={(e) => {
              const svg = e.currentTarget.parentElement?.querySelector("svg");
              if (!svg) return;
              const url = URL.createObjectURL(
                new Blob([new XMLSerializer().serializeToString(svg)], {
                  type: "image/svg+xml",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "box-label.svg";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download QR label
          </button>
        </div>
      )}
      <div className="spatial-item-list">
        {box.items.map((item) => (
          <article className="spatial-item-card" key={item.id}>
            <div className="spatial-item-title">
              <span>{item.name}</span>
              <strong>{item.quantity}</strong>
            </div>
            <p className="spatial-item-type">{item.type}</p>
            <div className="spatial-item-actions">
              <div className="spatial-stepper">
                <button
                  aria-label={`Decrease ${item.name}`}
                  disabled={!item.quantity}
                  onClick={() =>
                    update({
                      ...box,
                      items: box.items.map((i) =>
                        i.id === item.id ? changeQuantity(i, -1) : i,
                      ),
                    })
                  }
                >
                  <Minus size={13} />
                </button>
                <button
                  aria-label={`Increase ${item.name}`}
                  onClick={() =>
                    update({
                      ...box,
                      items: box.items.map((i) =>
                        i.id === item.id ? changeQuantity(i, 1) : i,
                      ),
                    })
                  }
                >
                  <Plus size={13} />
                </button>
              </div>
              <button
                className="spatial-remove"
                onClick={() =>
                  update({
                    ...box,
                    items: box.items.filter((i) => i.id !== item.id),
                  })
                }
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>
      {!box.items.length && !adding && (
        <p className="spatial-edit-hint">Nothing in this box yet.</p>
      )}
      {adding ? (
        <form className="spatial-add-form" onSubmit={addItem}>
          <label>
            Item name
            <input
              name="name"
              list="spatial-catalog"
              required
              maxLength={120}
              placeholder="Search catalog or name an item…"
            />
          </label>
          <datalist id="spatial-catalog">
            {catalog.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          <label>
            Quantity
            <input
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000000}
              step={1}
              defaultValue={1}
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="spatial-button" type="submit">
            Add to box
          </button>
          <button
            type="button"
            className="spatial-remove"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="spatial-button spatial-add-item"
          onClick={() => setAdding(true)}
        >
          <Plus />
          Add item
        </button>
      )}
      {!box.items.length && (
        <button
          className="spatial-remove spatial-delete-box"
          onClick={() => {
            onChange(boxes.filter((b) => b.id !== box.id));
            onSelect(null);
          }}
        >
          Remove empty box
        </button>
      )}
    </div>
  );
}

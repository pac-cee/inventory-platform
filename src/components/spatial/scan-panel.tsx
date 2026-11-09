"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Upload, QrCode } from "lucide-react";
import { parseSpatialQr, putInBox, type StorageBox } from "@/lib/spatial/boxes";
import type { SpatialItem, SpatialShelf } from "@/lib/spatial/model";
import type { Html5Qrcode } from "html5-qrcode";

function QrReader({ onRead }: { onRead: (value: string) => void }) {
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);
  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    let scanner: Html5Qrcode | undefined;
    const start = (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        scanner = new Html5Qrcode("spatial-camera-reader");
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 200, height: 200 } },
          (value) => {
            if (cancelled) return;
            cancelled = true;
            setCamera(false);
            onReadRef.current(value);
          },
          () => {},
        );
      } catch {
        if (!cancelled) {
          setError(
            "Camera unavailable. Allow camera access, upload a QR image, or paste the code.",
          );
          setCamera(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void start
        .then(async () => {
          if (scanner?.isScanning) await scanner.stop();
          scanner?.clear();
        })
        .catch(() => {});
    };
  }, [camera]);
  async function readImage(image: File | undefined) {
    if (!image) return;
    setLoading(true);
    setError("");
    let scanner: Html5Qrcode | undefined;
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      scanner = new Html5Qrcode("spatial-file-reader");
      const value = await scanner.scanFile(image, false);
      onRead(value);
    } catch {
      setError("No readable QR found. Try a clearer image.");
    } finally {
      scanner?.clear();
      setLoading(false);
    }
  }
  return (
    <>
      <div className="spatial-scanner-target">
        <div id="spatial-camera-reader" />
        {!camera && (
          <>
            <QrCode size={48} />
            <p>Scan an item or box label</p>
          </>
        )}
      </div>
      <div id="spatial-file-reader" hidden />
      <div className="spatial-scan-actions">
        <button
          className="spatial-button"
          disabled={loading}
          onClick={() => {
            setError("");
            setCamera(!camera);
          }}
        >
          <Camera size={16} />
          {camera ? "Stop camera" : "Use camera"}
        </button>
        <button
          className="spatial-button"
          disabled={camera || loading}
          onClick={() => file.current?.click()}
        >
          <Upload size={16} />
          {loading ? "Reading…" : "Upload QR"}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void readImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <form
        className="spatial-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          setCamera(false);
          onRead(String(new FormData(e.currentTarget).get("code")));
        }}
      >
        <label>
          Or paste a QR code
          <input
            name="code"
            required
            placeholder="inventory:item:…"
            spellCheck={false}
          />
        </label>
        <button className="spatial-button">Find code</button>
      </form>
      {error && (
        <p role="alert" className="spatial-edit-hint">
          {error}
        </p>
      )}
    </>
  );
}
export function ScanPanel({
  shelves,
  catalog,
  onBoxes,
  onChoose,
}: {
  shelves: SpatialShelf[];
  catalog: SpatialItem[];
  onBoxes: (id: string, boxes: StorageBox[]) => void;
  onChoose: (id: string, boxId?: string) => void;
}) {
  const [item, setItem] = useState<SpatialItem | null>(null);
  const [shelfId, setShelfId] = useState(shelves[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shelf = shelves.find((s) => s.id === shelfId);
  async function read(raw: string) {
    setError("");
    const qr = parseSpatialQr(raw);
    if (!qr) {
      setError("This is not an inventory item or box QR code.");
      return;
    }
    if (qr.kind === "item") {
      const found =
        catalog.find((i) => i.id === qr.id) ??
        shelves.flatMap((s) => s.items).find((i) => i.id === qr.id);
      if (!found) {
        setError(
          "This item is not in the inventory catalog. Open Inventory to register it first.",
        );
        return;
      }
      setItem(found);
      return;
    }
    if (qr.kind === "local-box") {
      const found = shelves.find((s) => s.boxes?.some((b) => b.id === qr.id));
      if (found) {
        onChoose(found.id, qr.id);
      } else setError("This box is not saved on this device.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/boxes/${encodeURIComponent(qr.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not look up box.");
      const found = shelves.find((s) => s.id === data.location?.id);
      if (!found)
        throw new Error(
          "That box is not on this floor. Add its location to the plan first.",
        );
      onChoose(found.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not look up box.");
    } finally {
      setBusy(false);
    }
  }
  function place(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!item || !shelf) return;
    const data = new FormData(e.currentTarget);
    let boxes = shelf.boxes ?? [];
    let boxId = String(data.get("box"));
    if (boxId === "new") {
      const name = String(data.get("label") ?? "").trim() || item.name;
      boxId = crypto.randomUUID();
      boxes = [...boxes, { id: boxId, name, items: [] }];
    }
    try {
      const next = putInBox(boxes, boxId, item, Number(data.get("quantity")));
      onBoxes(shelf.id, next);
      onChoose(shelf.id, boxId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place item.");
    }
  }
  return (
    <div className="spatial-scan-panel">
      <p className="spatial-edit-hint">
        {item
          ? "Choose where this item belongs."
          : "Scan a box to open it. Scan an item to choose where it goes."}
      </p>
      {!item ? (
        <QrReader
          onRead={(value) => {
            void read(value);
          }}
        />
      ) : (
        <form className="spatial-add-form" onSubmit={place}>
          <div className="spatial-found-item">
            <QrCode size={20} />
            <strong>{item.name}</strong>
          </div>
          <label>
            Shelf
            <select
              aria-label="Shelf"
              value={shelfId}
              onChange={(e) => setShelfId(e.target.value)}
            >
              {shelves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Box
            <select aria-label="Box" key={shelfId} name="box">
              {shelf?.boxes?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value="new">＋ New box</option>
            </select>
          </label>
          <label>
            New box label (if creating)
            <input name="label" maxLength={60} placeholder={item.name} />
          </label>
          <label>
            Quantity to add
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
          <button className="spatial-save" disabled={!shelf}>
            Place in box
          </button>
          <button
            className="spatial-remove"
            type="button"
            onClick={() => setItem(null)}
          >
            Scan another
          </button>
          <p className="spatial-local-note">
            Placement changes the local prototype. Save locally in the box panel
            to keep it.
          </p>
        </form>
      )}
      {busy && <p role="status">Looking up box…</p>}
      {error && (
        <p role="alert" className="spatial-edit-hint">
          {error}
        </p>
      )}
    </div>
  );
}

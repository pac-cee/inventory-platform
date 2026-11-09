import { parseBoxQr } from "../box-qr";
import type { SpatialItem } from "./model";
export interface StorageBox {
  id: string;
  name: string;
  slot?: number;
  items: SpatialItem[];
}
export type BoxMap = Record<string, StorageBox[]>;
export function seedBoxes(shelfId: string, items: SpatialItem[]): StorageBox[] {
  return items.map((item, index) => ({
    id: `${shelfId}-${item.id}-${index}`,
    name: item.name,
    items: [{ ...item }],
  }));
}
export function putInBox(
  boxes: StorageBox[],
  boxId: string,
  item: SpatialItem,
  quantity: number,
): StorageBox[] {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000)
    throw new Error("Enter a whole quantity between 1 and 1,000,000.");
  if (!boxes.some((box) => box.id === boxId))
    throw new Error("Choose a box first.");
  return boxes.map((box) => {
    if (box.id !== boxId) return box;
    const found = box.items.find((i) => i.id === item.id);
    if ((found?.quantity ?? 0) + quantity > 1000000)
      throw new Error("This box cannot exceed 1,000,000 units per item.");
    return {
      ...box,
      items: found
        ? box.items.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  quantity: i.quantity + quantity,
                  capacity: Math.max(i.capacity, i.quantity + quantity),
                }
              : i,
          )
        : [...box.items, { ...item, quantity, capacity: quantity }],
    };
  });
}
export function readBoxes(raw: string | null): BoxMap {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: BoxMap = {};
    for (const [key, boxes] of Object.entries(value)) {
      if (
        !Array.isArray(boxes) ||
        !boxes.every(
          (b) =>
            b &&
            typeof b.id === "string" &&
            typeof b.name === "string" &&
            Array.isArray(b.items) &&
            b.items.every(
              (i: SpatialItem) =>
                i &&
                typeof i.id === "string" &&
                typeof i.name === "string" &&
                typeof i.type === "string" &&
                Number.isSafeInteger(i.quantity) &&
                i.quantity >= 0 &&
                Number.isFinite(i.capacity) &&
                i.capacity >= 0,
            ),
        )
      )
        continue;
      result[key] = boxes;
    }
    return result;
  } catch {
    return {};
  }
}
export function parseSpatialQr(
  raw: string,
): { kind: "item" | "box" | "local-box"; id: string } | null {
  const value = raw.trim();
  const box = parseBoxQr(value);
  if (box) return { kind: "box", id: box };
  for (const [prefix, kind] of [
    ["inventory:item:", "item"],
    ["inventory:spatial-box:", "local-box"],
  ] as const) {
    if (value.startsWith(prefix)) {
      const id = value.slice(prefix.length).trim();
      return /^[a-zA-Z0-9_-]{1,180}$/.test(id) ? { kind, id } : null;
    }
  }
  return /^[0-9a-fA-F-]{32,40}$/.test(value)
    ? { kind: "item", id: value }
    : null;
}

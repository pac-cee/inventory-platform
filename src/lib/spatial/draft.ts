import { clampPlacement, type SpatialItem, type SpatialShelf } from "./model";
export interface SpatialDraft {
  extras: SpatialShelf[];
  items: Record<string, SpatialItem[]>;
}
export function changeQuantity(item: SpatialItem, delta: number): SpatialItem {
  const quantity = Math.max(0, Math.min(1000000, item.quantity + delta));
  return { ...item, quantity, capacity: Math.max(item.capacity, quantity) };
}
function isItem(value: unknown): value is SpatialItem {
  if (!value || typeof value !== "object") return false;
  const item = value as SpatialItem;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.type === "string" &&
    Number.isFinite(item.quantity) &&
    item.quantity >= 0 &&
    Number.isFinite(item.capacity) &&
    item.capacity >= 0
  );
}
export function readDraft(raw: string | null): SpatialDraft {
  try {
    const value = JSON.parse(raw ?? "{}");
    const extras: SpatialShelf[] = Array.isArray(value?.extras)
      ? value.extras
          .filter(
            (s: SpatialShelf) =>
              s &&
              typeof s.id === "string" &&
              s.id.startsWith("prototype-") &&
              typeof s.name === "string" &&
              [s.x, s.z, s.rotation].every(
                (n) => typeof n === "number" && Number.isFinite(n),
              ) &&
              Array.isArray(s.items) &&
              s.items.every(isItem),
          )
          .map((s: SpatialShelf) => ({
            ...s,
            ...clampPlacement(s),
            prototype: true,
          }))
      : [];
    const items: Record<string, SpatialItem[]> =
      value?.items &&
      typeof value.items === "object" &&
      !Array.isArray(value.items)
        ? Object.fromEntries(
            Object.entries(value.items).filter(
              (entry): entry is [string, SpatialItem[]] =>
                Array.isArray(entry[1]) && entry[1].every(isItem),
            ),
          )
        : {};
    return { extras, items };
  } catch {
    return { extras: [], items: {} };
  }
}

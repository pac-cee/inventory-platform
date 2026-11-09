import type { StorageBox } from "./boxes";
export function resolveSlots(
  boxes: StorageBox[],
): (StorageBox & { slot: number })[] {
  const used = new Set<number>();
  const reserved = boxes.map((b) => {
    if (
      Number.isSafeInteger(b.slot) &&
      b.slot! >= 0 &&
      b.slot! < 400 &&
      !used.has(b.slot!)
    ) {
      used.add(b.slot!);
      return b.slot!;
    }
    return null;
  });
  return boxes.map((b, i) => {
    let slot = reserved[i];
    if (slot === null) {
      slot = 0;
      while (used.has(slot)) slot++;
      used.add(slot);
    }
    return { ...b, slot };
  });
}
export function placeBox(
  boxes: StorageBox[],
  id: string,
  slot: number,
): StorageBox[] {
  const placed = resolveSlots(boxes);
  const source = placed.find((b) => b.id === id);
  if (!source || !Number.isSafeInteger(slot) || slot < 0 || slot >= 400)
    return placed;
  return placed.map((b) =>
    b.id === id
      ? { ...b, slot }
      : b.slot === slot
        ? { ...b, slot: source.slot }
        : b,
  );
}
export function copyEmptyBox(box: StorageBox, id: string): StorageBox {
  return { id, name: `${box.name} copy`, items: [] };
}
export function occupiedLevels(boxes: StorageBox[]) {
  return Math.max(
    1,
    ...resolveSlots(boxes).map((b) => Math.floor(b.slot / 4) + 1),
  );
}

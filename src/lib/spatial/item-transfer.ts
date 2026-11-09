import { putInBox, type BoxMap } from "./boxes";
import type { SpatialItem } from "./model";
export const ITEM_DRAG_TYPE = "application/x-verlet-item";
export interface BoxAddress {
  shelfId: string;
  boxId: string;
}
export interface ItemTransfer {
  itemId: string;
  quantity: number;
  source?: BoxAddress;
}
export function transferItems(
  boxes: BoxMap,
  catalog: SpatialItem[],
  move: ItemTransfer,
  target: BoxAddress | null,
): BoxMap {
  if (
    !move ||
    typeof move.itemId !== "string" ||
    !Number.isSafeInteger(move.quantity) ||
    move.quantity < 1 ||
    move.quantity > 1000000
  )
    throw new Error("Choose a whole quantity from 1 to 1,000,000.");
  const source = move.source
    ? boxes[move.source.shelfId]?.find((b) => b.id === move.source!.boxId)
    : undefined;
  const item = move.source
    ? source?.items.find((i) => i.id === move.itemId)
    : catalog.find((i) => i.id === move.itemId);
  if (!item)
    throw new Error("This item is no longer available. Select it again.");
  if (move.source && item.quantity < move.quantity)
    throw new Error(`Only ${item.quantity} units are available in this box.`);
  if (!target && !move.source)
    throw new Error("Pick out items from a box, not the catalogue.");
  if (target && !boxes[target.shelfId]?.some((b) => b.id === target.boxId))
    throw new Error("Choose an existing destination box.");
  if (
    target &&
    move.source &&
    target.shelfId === move.source.shelfId &&
    target.boxId === move.source.boxId
  )
    return boxes;
  const next = { ...boxes };
  if (move.source) {
    const { shelfId, boxId } = move.source;
    next[shelfId] = next[shelfId].map((b) =>
      b.id === boxId
        ? {
            ...b,
            items: b.items
              .map((i) =>
                i.id === item.id
                  ? { ...i, quantity: i.quantity - move.quantity }
                  : i,
              )
              .filter((i) => i.quantity > 0),
          }
        : b,
    );
  }
  if (target)
    next[target.shelfId] = putInBox(
      next[target.shelfId],
      target.boxId,
      item,
      move.quantity,
    );
  return next;
}

import { expect, it } from "vitest";
import { resolveSlots, placeBox, copyEmptyBox } from "./box-placement";
const boxes = [
  { id: "a", name: "A", items: [] },
  { id: "b", name: "B", items: [] },
];
it("keeps explicit positions and assigns free positions to old boxes", () => {
  expect(
    resolveSlots([{ ...boxes[0], slot: 5 }, boxes[1]]).map((b) => b.slot),
  ).toEqual([5, 0]);
});
it("swaps occupied slots without losing boxes", () => {
  expect(placeBox(boxes, "a", 1).map((b) => b.slot)).toEqual([1, 0]);
});
it("copies a box label but never its stock or occupied position", () => {
  expect(
    copyEmptyBox(
      {
        ...boxes[0],
        slot: 5,
        items: [
          { id: "i", name: "Item", type: "Item", quantity: 5, capacity: 5 },
        ],
      },
      "copy",
    ),
  ).toEqual({ id: "copy", name: "A copy", items: [] });
});
it("repairs duplicate and invalid slots", () => {
  expect(
    resolveSlots([
      { ...boxes[0], slot: 2 },
      { ...boxes[1], slot: 2 },
      { id: "c", name: "C", items: [], slot: -1 },
    ]).map((b) => b.slot),
  ).toEqual([2, 0, 1]);
});

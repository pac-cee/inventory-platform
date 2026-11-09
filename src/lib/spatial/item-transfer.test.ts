import { expect, it } from "vitest";
import { transferItems } from "./item-transfer";
const item = {
  id: "i",
  name: "Pi",
  type: "Computer",
  quantity: 5,
  capacity: 10,
};
const boxes = {
  s: [
    { id: "a", name: "A", items: [item] },
    { id: "b", name: "B", items: [] },
  ],
};
it("moves quantities without creating stock", () => {
  const next = transferItems(
    boxes,
    [item],
    { itemId: "i", quantity: 2, source: { shelfId: "s", boxId: "a" } },
    { shelfId: "s", boxId: "b" },
  );
  expect(next.s[0].items[0].quantity).toBe(3);
  expect(next.s[1].items[0].quantity).toBe(2);
  expect(boxes.s[0].items[0].quantity).toBe(5);
});
it("rejects picking more than available", () => {
  expect(() =>
    transferItems(
      boxes,
      [item],
      { itemId: "i", quantity: 6, source: { shelfId: "s", boxId: "a" } },
      null,
    ),
  ).toThrow();
});
it("adds catalogue stock to a named box", () => {
  expect(
    transferItems(
      boxes,
      [item],
      { itemId: "i", quantity: 3 },
      { shelfId: "s", boxId: "b" },
    ).s[1].items[0].quantity,
  ).toBe(3);
});
it("picks out stock without a destination", () => {
  expect(
    transferItems(
      boxes,
      [item],
      { itemId: "i", quantity: 5, source: { shelfId: "s", boxId: "a" } },
      null,
    ).s[0].items,
  ).toEqual([]);
});
it("rejects an invalid destination before changing the source", () => {
  expect(() =>
    transferItems(
      boxes,
      [item],
      { itemId: "i", quantity: 2, source: { shelfId: "s", boxId: "a" } },
      { shelfId: "s", boxId: "missing" },
    ),
  ).toThrow();
  expect(boxes.s[0].items[0].quantity).toBe(5);
});
it("same-box drops do not change stock", () => {
  expect(
    transferItems(
      boxes,
      [item],
      { itemId: "i", quantity: 2, source: { shelfId: "s", boxId: "a" } },
      { shelfId: "s", boxId: "a" },
    ),
  ).toEqual(boxes);
});

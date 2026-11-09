import { expect, it } from "vitest";
import { seedBoxes, readBoxes, putInBox, parseSpatialQr } from "./boxes";
const item = {
  id: "item-a",
  name: "Sensor",
  type: "Parts",
  quantity: 8,
  capacity: 12,
};
it("seeds individually addressable boxes without duplicating stock", () => {
  const boxes = seedBoxes("lab", [item]);
  expect(boxes).toHaveLength(1);
  expect(boxes[0].items[0].quantity).toBe(8);
  expect(seedBoxes("lab", [item])[0].id).toBe(boxes[0].id);
  expect(seedBoxes("empty", [])).toEqual([]);
});
it("adds only to the chosen box and merges an existing item", () => {
  const boxes = [
    { id: "a", name: "Sensors", items: [item] },
    { id: "b", name: "Cables", items: [] },
  ];
  const next = putInBox(boxes, "a", item, 2);
  expect(next[0].items[0].quantity).toBe(10);
  expect(next[1].items).toEqual([]);
  expect(boxes[0].items[0].quantity).toBe(8);
  expect(() => putInBox(boxes, "a", item, -2)).toThrow();
  expect(() => putInBox(boxes, "missing", item, 1)).toThrow();
});
it("restores labels and rejects invalid saved boxes", () => {
  const good = { lab: [{ id: "a", name: "Sensors", items: [item] }] };
  expect(readBoxes(JSON.stringify(good))).toEqual(good);
  expect(readBoxes("{bad")).toEqual({});
  expect(
    readBoxes(
      JSON.stringify({
        lab: [{ id: "a", name: "Bad", items: [{ ...item, quantity: -1 }] }],
      }),
    ),
  ).toEqual({});
});
it("parses known QR payloads without following arbitrary URLs", () => {
  expect(parseSpatialQr("inventory:item:abc")).toEqual({
    kind: "item",
    id: "abc",
  });
  expect(parseSpatialQr("inventory:spatial-box:box-1")).toEqual({
    kind: "local-box",
    id: "box-1",
  });
  expect(parseSpatialQr("https://example.com")).toBeNull();
  expect(parseSpatialQr("inventory:item:")).toBeNull();
});

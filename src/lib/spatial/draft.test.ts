import { expect, it } from "vitest";
import { changeQuantity, readDraft } from "./draft";
it("never makes stock negative and grows capacity when adding stock", () => {
  expect(
    changeQuantity(
      { id: "a", name: "Cable", type: "Part", quantity: 1, capacity: 2 },
      -5,
    ).quantity,
  ).toBe(0);
  expect(
    changeQuantity(
      { id: "a", name: "Cable", type: "Part", quantity: 2, capacity: 2 },
      1,
    ),
  ).toMatchObject({ quantity: 3, capacity: 3 });
});
it("rejects corrupt saved drafts", () => {
  expect(readDraft("{broken")).toEqual({ extras: [], items: {} });
  expect(
    readDraft('{"extras":[{"id":"x"}],"items":{"x":[{"name":"bad"}]}}'),
  ).toEqual({ extras: [], items: {} });
});
it("restores valid local item edits", () => {
  const draft = {
    extras: [],
    items: {
      shelf: [
        { id: "a", name: "Cable", type: "Part", quantity: 0, capacity: 2 },
      ],
    },
  };
  expect(readDraft(JSON.stringify(draft))).toEqual(draft);
});

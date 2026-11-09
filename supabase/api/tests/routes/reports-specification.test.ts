import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";

/**
 * Specification on the condition report.
 *
 * Two variants of one product share a name and a category and differ only by
 * specification — 8GB vs 16GB of the same laptop. The report has to carry that
 * field, or the two rows are indistinguishable and read as a duplicate.
 *
 * They must also stay independent: damage on one variant must not move the
 * other's % operational.
 */
describe("condition report — specification", () => {
  let adminH: Record<string, string>;
  let roomId: string;
  let small: string;
  let large: string;
  const stamp = Date.now();
  const NAME = `Dell Latitude 5420 ${stamp}`;
  const CATEGORY = `Computers ${stamp}`;

  const rowFor = async (itemId: string) => {
    const res = await app.get(`/reports/condition?item_id=${itemId}`).set(adminH);
    expect(res.status).toBe(200);
    return res.body[0];
  };

  // Stock arrives through the ledger, not on the item itself.
  const addItem = async (specification: string, name: string, quantity: number) => {
    const res = await app
      .post("/items")
      .set(adminH)
      .send({ type: NAME, name, model: "Std", specification, category: CATEGORY });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const stock = await app
      .post("/movements")
      .set(adminH)
      .send({ item_id: id, location_id: roomId, delta: quantity, reason: "initial" });
    expect(stock.status).toBe(201);
    return id;
  };

  beforeAll(async () => {
    adminH = await authHeaders("admin");

    const room = await app.post("/locations").set(adminH).send({ name: `spec-room-${stamp}` });
    roomId = room.body.id;

    small = await addItem("8GB RAM · 256GB SSD", `SPEC-${stamp}-08`, 10);
    large = await addItem("16GB RAM · 512GB SSD", `SPEC-${stamp}-16`, 10);
  });

  it("returns the specification for each variant", async () => {
    expect((await rowFor(small)).specification).toBe("8GB RAM · 256GB SSD");
    expect((await rowFor(large)).specification).toBe("16GB RAM · 512GB SSD");
  });

  it("keeps variants as separate rows under one type and category", async () => {
    const a = await rowFor(small);
    const b = await rowFor(large);
    // Same type, different names — that is what makes them variants now.
    expect(a.type).toBe(b.type);
    expect(a.name).not.toBe(b.name);
    expect(a.category).toBe(b.category);
    expect(a.item_id).not.toBe(b.item_id);
    expect(a.specification).not.toBe(b.specification);
  });

  it("scores each variant on its own damage", async () => {
    // Two dead batteries on the 8GB batch only.
    const res = await app
      .post("/movements/destroy")
      .set(adminH)
      .send({
        item_id: small,
        location_id: roomId,
        quantity: 2,
        note: "battery dead",
        recommendation: "Replace batteries",
      });
    expect(res.status).toBe(201);

    const damaged = await rowFor(small);
    const untouched = await rowFor(large);

    expect(damaged.damaged).toBe(2);
    expect(damaged.operational).toBe(8);
    // The other variant must not absorb any of it.
    expect(untouched.damaged).toBe(0);
    expect(untouched.operational).toBe(10);
  });

  it("allows the same type and category when the name differs", async () => {
    const res = await app
      .post("/items")
      .set(adminH)
      .send({
        type: NAME,
        name: `SPEC-${stamp}-32`,
        model: "Std",
        specification: "32GB RAM · 1TB SSD",
        category: CATEGORY,
      });
    expect(res.status).toBe(201);
  });

  it("still rejects a true duplicate — same type, name and model", async () => {
    const res = await app
      .post("/items")
      .set(adminH)
      .send({
        type: NAME,
        name: `SPEC-${stamp}-08`,
        model: "Std",
        specification: "8GB RAM · 256GB SSD",
        category: CATEGORY,
      });
    expect(res.status).toBe(409);
  });
});

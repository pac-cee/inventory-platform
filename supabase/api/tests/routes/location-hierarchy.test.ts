import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { one } from "../../src/db.js";

// The store is laid out Area > Shelf > Level > Box, and a box is always the last step.
describe("location hierarchy: Area > Shelf > Level > Box", () => {
  let managerH: Record<string, string>;
  let adminH: Record<string, string>;
  let memberH: Record<string, string>;
  const ids: string[] = [];
  const stamp = Date.now();
  let area = "", shelf = "", level = "", box = "";

  const make = async (name: string, kind?: string, parent_id?: string | null) => {
    const res = await app.post("/locations").set(managerH).send({ name: `${name}-${stamp}`, ...(kind ? { kind } : {}), ...(parent_id !== undefined ? { parent_id } : {}) });
    if (res.body?.id) ids.push(res.body.id);
    return res;
  };

  beforeAll(async () => {
    managerH = await authHeaders("manager");
    adminH = await authHeaders("admin");
    memberH = await authHeaders("member");
    area = (await make("h-area", "area")).body.id;
    shelf = (await make("h-shelf", "shelf", area)).body.id;
    level = (await make("h-level", "level", shelf)).body.id;
    box = (await make("h-box", "box", level)).body.id;
  });
  afterAll(async () => {
    for (const id of [...ids].reverse()) await app.delete(`/locations/${id}`).set(adminH).catch(() => {});
  });

  it("the valid chain was accepted at every step", () => {
    expect([area, shelf, level, box].every(Boolean)).toBe(true);
  });

  it("a box cannot be created at the top level — the bug", async () => {
    const res = await make("loose-box", "box");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("invalid_kind_for_parent");
    expect(res.body.error.message).toMatch(/box has to sit on a level/);
    expect(res.body.error.message).toMatch(/Area > Shelf > Level > Box/);
  });

  it("a box cannot sit on a shelf or in an area (it needs a level)", async () => {
    expect((await make("b-on-shelf", "box", shelf)).status).toBe(422);
    expect((await make("b-in-area", "box", area)).status).toBe(422);
  });

  it("nothing can be put inside a box", async () => {
    for (const kind of ["area", "shelf", "level", "box"]) {
      const res = await make(`in-box-${kind}`, kind, box);
      expect(res.status, kind).toBe(422);
    }
  });

  it("each kind only fits under the one above it", async () => {
    expect((await make("s-top", "shelf")).status).toBe(422); // a shelf needs an area
    expect((await make("s-on-shelf", "shelf", shelf)).status).toBe(422);
    expect((await make("l-top", "level")).status).toBe(422); // a level needs a shelf
    expect((await make("l-in-area", "level", area)).status).toBe(422);
  });

  it("an area can be top-level or inside another area (older places are all 'area')", async () => {
    expect((await make("a-top", "area")).status).toBe(201);
    expect((await make("a-in-area", "area", area)).status).toBe(201);
    expect((await make("a-default")).status).toBe(201); // no kind given = area
    expect((await make("a-in-level", "area", level)).status).toBe(422);
  });

  it("moving a box to a place that is not a level is refused; moving it between levels works", async () => {
    const level2 = (await make("h-level2", "level", shelf)).body.id;
    expect((await app.patch(`/locations/${box}`).set(managerH).send({ parent_id: shelf })).status).toBe(422);
    expect((await app.patch(`/locations/${box}`).set(managerH).send({ parent_id: null })).status).toBe(422);
    const moved = await app.patch(`/locations/${box}`).set(managerH).send({ parent_id: level2 });
    expect(moved.status).toBe(200);
    expect(moved.body.parent_id).toBe(level2);
  });

  it("a box cannot be made out of a place that has things inside it", async () => {
    const parent = (await make("with-kid", "level", shelf)).body.id;
    await make("kid", "box", parent);
    const res = await app.patch(`/locations/${parent}`).set(managerH).send({ kind: "box" });
    expect(res.status).toBe(422);
  });

  it("changing a place's kind is refused when what is inside would no longer fit", async () => {
    // the shelf holds levels: it cannot become a box, nor a level
    const toBox = await app.patch(`/locations/${shelf}`).set(managerH).send({ kind: "box" });
    expect(toBox.status).toBe(422);
    const toLevel = await app.patch(`/locations/${level}`).set(managerH).send({ kind: "shelf" });
    expect(toLevel.status).toBe(422);
  });

  it("renaming or re-photographing a place never trips the rules (only kind/parent are checked)", async () => {
    const res = await app.patch(`/locations/${level}`).set(managerH).send({ name: `h-level-renamed-${stamp}` });
    expect(res.status).toBe(200);
  });

  it("nothing can be added inside an old place that never got its type — it must be typed first, from the top down", async () => {
    // Places made before types existed are all "area", wherever they sit; made here by SQL.
    // an old level: stored as "area" but sitting inside a shelf
    const oldLevel = (await one<{ id: string }>("insert into locations (name, parent_id, kind) values ($1, $2, 'area') returning id", [`old-level-${stamp}`, shelf])).id;
    ids.push(oldLevel);

    // a box inside the untyped "level" (the wrong-level trap) and a shelf inside it are both refused
    const box = await make("b-in-old-level", "box", oldLevel);
    expect(box.status).toBe(422);
    expect(box.body.error.code).toBe("parent_needs_type");
    expect((await make("s-in-old-level", "shelf", oldLevel)).status).toBe(422);
    // once it is typed as a level, a box can go on it
    expect((await app.patch(`/locations/${oldLevel}`).set(managerH).send({ kind: "level" })).status).toBe(200);
    expect((await make("b-on-typed-level", "box", oldLevel)).status).toBe(201);
  });

  it("a grouping area inside an area (like \"Shelves\" inside a room) can hold shelves", async () => {
    const grouping = (await make("grp-shelves", "area", area)).body.id;
    expect(grouping).toBeTruthy();
    const res = await make("grp-shelf-7", "shelf", grouping);
    expect(res.status).toBe(201);
  });

  it("members still cannot create places at all", async () => {
    expect((await app.post("/locations").set(memberH).send({ name: `m-${stamp}`, kind: "area" })).status).toBe(403);
  });
});

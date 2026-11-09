import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../helpers/app.js";
import { authHeaders } from "../helpers/auth.js";
import { createItem } from "../helpers/items.js";
import { exec, one } from "../../src/db.js";

/**
 * Managing item categories.
 *
 * There is no categories table: a category exists only because items carry the
 * text, so "retiring" one clears it off those items. These pin the two things
 * that make that safe — an exact match (so a typo can be retired without
 * touching the real category) and the permission boundary.
 */

const stamp = Date.now();
const REAL = `Cables ${stamp}`;
const TYPO = `cables ${stamp}`;
const UNUSED = `Nobody ${stamp}`;

let adminH: Record<string, string>;
let memberH: Record<string, string>;
let managerH: Record<string, string>;
let managerId: string;
const created: string[] = [];

beforeAll(async () => {
  adminH = await authHeaders("admin");
  memberH = await authHeaders("member");

  // Two items on the real category, one on a mistyped variant.
  created.push(await createItem(adminH, { type: `Cat A ${stamp}`, category: REAL }));
  created.push(await createItem(adminH, { type: `Cat B ${stamp}`, category: REAL }));
  created.push(await createItem(adminH, { type: `Cat C ${stamp}`, category: TYPO }));

  // A stock manager, to prove warehouse rights are enough.
  const email = `cat-manager-${stamp}@inventory.test`;
  await app.post("/auth/signup").send({ email, password: "CatPass123!" });
  const row = await one<{ id: string }>("select id from users where email = $1", [email]);
  managerId = row.id;
  await exec("update users set email_confirmed = true where id = $1", [managerId]);
  await exec(
    `update profiles set role = 'stock_manager', approval_status = 'approved', blocked = false
       where id = $1`,
    [managerId],
  );
  const login = await app.post("/auth/login").send({ email, password: "CatPass123!" });
  managerH = { Authorization: `Bearer ${login.body.session.access_token}` };
});

afterAll(async () => {
  for (const id of created) await app.delete(`/items/${id}`).set(adminH);
  if (managerId) await exec("delete from users where id = $1", [managerId]);
});

describe("GET /items/categories", () => {
  it("lists categories in use with a count of the items carrying each", async () => {
    const res = await app.get("/items/categories").set(memberH);
    expect(res.status).toBe(200);
    const real = res.body.find((c: { category: string }) => c.category === REAL);
    expect(real).toBeTruthy();
    expect(real.items).toBe(2);
    expect(res.body.find((c: { category: string }) => c.category === TYPO).items).toBe(1);
  });

  it("is not mistaken for an item id", async () => {
    // `/categories` is declared before `/:id`; if that order ever flips this
    // returns 404 "Item not found" instead of the list.
    const res = await app.get("/items/categories").set(memberH);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("DELETE /items/categories/:name", () => {
  it("refuses a plain member", async () => {
    const res = await app.delete(`/items/categories/${encodeURIComponent(TYPO)}`).set(memberH);
    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await app.delete(`/items/categories/${encodeURIComponent(TYPO)}`);
    expect(res.status).toBe(401);
  });

  it("404s for a category nothing uses, rather than reporting success", async () => {
    const res = await app.delete(`/items/categories/${encodeURIComponent(UNUSED)}`).set(adminH);
    expect(res.status).toBe(404);
  });

  it("lets a stock manager retire one, and clears it only from its own items", async () => {
    const res = await app.delete(`/items/categories/${encodeURIComponent(TYPO)}`).set(managerH);
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(1);

    const list = await app.get("/items/categories").set(adminH);
    // The typo is gone...
    expect(list.body.some((c: { category: string }) => c.category === TYPO)).toBe(false);
    // ...and the real category, differing only by case, is untouched.
    expect(list.body.find((c: { category: string }) => c.category === REAL).items).toBe(2);
  });

  it("clears every item carrying the category, not just one", async () => {
    const res = await app.delete(`/items/categories/${encodeURIComponent(REAL)}`).set(adminH);
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(2);

    const list = await app.get("/items/categories").set(adminH);
    expect(list.body.some((c: { category: string }) => c.category === REAL)).toBe(false);
  });

  it("leaves the items themselves alone — only the category is cleared", async () => {
    const item = await app.get(`/items/${created[0]}`).set(adminH);
    expect(item.status).toBe(200);
    expect(item.body.category).toBeNull();
    expect(item.body.sku).toMatch(/^vrlt-/);
    expect(item.body.type).toBeTruthy();
  });
});

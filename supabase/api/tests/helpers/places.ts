import type { Test } from "supertest";

type Api = { post: (url: string) => Test; delete: (url: string) => Test };

/**
 * Area > Shelf > Level, ready for boxes. A test file that needs many boxes builds this ONCE
 * and puts them all on the level: every call is a round trip to the database.
 */
export async function makeLevel(app: Api, h: Record<string, string>, name: string) {
  const make = async (n: string, kind: string, parent_id?: string) => {
    const res = await app.post("/locations").set(h).send({ name: n, kind, ...(parent_id ? { parent_id } : {}) });
    return res.body.id as string;
  };
  const area = await make(`${name}-area`, "area");
  const shelf = await make(`${name}-shelf`, "shelf", area);
  const level = await make(`${name}-level`, "level", shelf);
  return { level, ids: [area, shelf, level] };
}

/**
 * A box in its proper place: Area > Shelf > Level > Box (a box must sit on a level).
 * Returns the box's response and every id created, outermost first, so a test can
 * clean up with removePlaces().
 */
export async function makeBox(
  app: Api,
  h: Record<string, string>,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const chain = await makeLevel(app, h, name);
  const box = await app.post("/locations").set(h).send({ name, kind: "box", parent_id: chain.level, ...extra });
  return { box, level: chain.level, chain: [...chain.ids, box.body.id as string] };
}

/** Delete places innermost first (a place with something inside cannot be deleted). */
export async function removePlaces(app: Api, h: Record<string, string>, ids: string[]) {
  for (const id of [...ids].reverse()) await app.delete(`/locations/${id}`).set(h).catch(() => {});
}

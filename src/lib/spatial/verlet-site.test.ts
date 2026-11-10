import { expect, it } from "vitest";
import {
  AREA,
  COLUMNS,
  COLUMN_SIZE,
  DOOR,
  PIECES,
  REPLACED,
  TABLE_HOMES,
  locationHome,
  pieceRect,
  siteObstacles,
  type Rect,
} from "./verlet-site";

const LOCATIONS = [
  "Cables box", "Camera box", "Field Kit", "Front desk", "Lab A", "Main Store",
  "Main Warehouse", "Office", "Rack 1", "Rack 1 · Level 2", "Robotics Lab",
  "Shelf A", "Shelf B",
];
const overlap = (a: Rect, b: Rect) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
/** A live shelf is drawn 2 m wide and 0.5 m deep. */
function shelfRect(x: number, z: number, rotation: number): Rect {
  const side = Math.abs(Math.sin((rotation * Math.PI) / 180)) > 0.5;
  const hx = side ? 0.25 : 1, hz = side ? 1 : 0.25;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}
function tableRect(x: number, z: number, rotation: number): Rect {
  const side = Math.abs(Math.sin((rotation * Math.PI) / 180)) > 0.5;
  const hx = side ? 0.5 : 1, hz = side ? 1 : 0.5;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}
const hall = PIECES.filter((p) => !REPLACED.has(p.id) && p.z > AREA.z0);
const live: [string, Rect][] = [
  ...LOCATIONS.map((n) => {
    const h = locationHome(n, 0);
    return [n, shelfRect(h.x, h.z, h.rotation)] as [string, Rect];
  }),
  ...Object.entries(TABLE_HOMES).map(([id, h]) => [id, tableRect(h.x, h.z, h.rotation)] as [string, Rect]),
];
const scenery: [string, Rect][] = [
  ...hall.map((p) => [p.id, pieceRect(p, 0)] as [string, Rect]),
  ...COLUMNS.map(([x, z]) => {
    const c = COLUMN_SIZE / 2;
    return [`column ${x},${z}`, { minX: x - c, maxX: x + c, minZ: z - c, maxZ: z + c }] as [string, Rect];
  }),
  ...siteObstacles(0).slice(hall.length + COLUMNS.length).map((r, i) => [`rack ${i}`, r] as [string, Rect]),
];

it("keeps every shelf, table and piece inside the hall's walls", () => {
  for (const [name, r] of [...live, ...scenery])
    expect(
      r.minX >= AREA.x0 && r.maxX <= AREA.x1 && r.minZ >= AREA.z0 && r.maxZ <= AREA.z1,
      name,
    ).toBe(true);
});
it("never stands two things in the same place", () => {
  const all = [...live, ...scenery];
  const clashes: string[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (overlap(all[i][1], all[j][1])) clashes.push(`${all[i][0]} × ${all[j][0]}`);
  expect(clashes).toEqual([]);
});
it("keeps the way in through the north door clear", () => {
  const lobby = { minX: DOOR.x - DOOR.w / 2, maxX: DOOR.x + DOOR.w / 2, minZ: AREA.z0, maxZ: AREA.z0 + 2.4 };
  const blocking = [...live, ...scenery].filter(([, r]) => overlap(r, lobby)).map(([n]) => n);
  expect(blocking).toEqual([]);
});

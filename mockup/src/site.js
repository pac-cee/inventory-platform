// Verlet's part of an upper floor, estimated from the walk-through video
// (~/Invetory/IMG_2712.mov, 2026-11-09): one open-plan hall on a ~6 m column
// grid, 60 cm glossy tiles, yellow walls on two sides, floor-to-ceiling glazing
// with a louvred top band on the view side, frosted-glass partitions where
// Verlet's space meets the rest of the floor. Departments are zones, not rooms.
//
// ESTIMATED. Sizes come from tile and column counts in the video; zone
// positions follow the order the video walks through them. The layout editor
// in the app is the way to correct anything that's off.
// Units are metres; x runs east, z runs south (towards the view), y is up.
// Verlet's floor sits at y = 0; the storeys below reach down to the street.

export const PLACEHOLDER = true;   // building outline + floor count still estimated

export const TOWER = {
  name: "Office block",
  floors: 6,
  verletFloor: 5,                 // an upper floor: the video looks out over the hills
  floorHeight: 3.8,
  plate: { x0: -18.5, x1: 42.5, z0: -12.5, z1: 12.5 },   // whole floor, outer face
  street: { z: 24, width: 10 },
};
export const BELOW = TOWER.verletFloor - 1;
export const ABOVE = TOWER.floors - TOWER.verletFloor;
export const GROUND_Y = -BELOW * TOWER.floorHeight;
export const CEILING = 3.2;        // clear height under the ceiling panels

// Verlet's area within the plate; the rest of the floor belongs to other tenants
export const AREA = { x0: -18, x1: 18, z0: -12, z1: 12 };
export const GRID = 6;             // column spacing
export const COLUMN = 0.5;         // column section
// walls round Verlet's area: what each side is made of
export const EDGES = { north: "yellow", west: "yellow", south: "glazing", east: "partition" };
export const DOOR = { x: 18, z: -1.5, w: 2.0 };     // glass double door in the partition
export const LIFTS = { x: 31, z: -1.5 };            // lift lobby beyond the partition
export const WALKWAY_Z = -2;                         // the main cross-floor walkway

// Zones on Verlet's floor (departments). x/z are zone centres.
// Ids are kept from the earlier versions so saved layouts still line up.
export const ROOMS = [
  { id: "b-store", name: "Stockroom corner", x: -11, z: -8, w: 14, d: 8, fixed: true },
  { id: "b-robotics", name: "Robotics desks", x: 2, z: -8, w: 12, d: 8 },
  { id: "b-lab", name: "Electronics & printing", x: 13, z: -7, w: 10, d: 10 },
  { id: "b-office", name: "Dev rows", x: -5, z: 6, w: 26, d: 12 },
  { id: "b-field", name: "Kit bay", x: 13, z: 7, w: 10, d: 10 },
];
export const BUILDINGS = ROOMS;     // the data layer calls zones "buildings"
export const MIRRORED = new Set();  // zones have no doors; layouts are written for these sizes

// Stockroom shelving: pine units along the yellow walls (an L), boxes on each shelf.
// Each rack is a run of bays starting at (x, z) and running along `dir`.
export const SHELVING = {
  bayW: 1.05, depth: 0.45, height: 2.4, levels: [0.12, 0.7, 1.28, 1.86],
  racks: [
    { name: "A", x: -17.5, z: -11.55, dir: "east" },
    { name: "B", x: -14.25, z: -11.55, dir: "east" },
    { name: "C", x: -17.55, z: -10.6, dir: "south" },
  ],
};

export const TREES = [[-26, 20], [-12, 20.5], [2, 20], [18, 20.5], [32, 20], [48, 20.5], [-28, 4], [52, 2], [-28, -14], [52, -14]];

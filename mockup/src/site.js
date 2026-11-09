// The site: every building, floor, door and window as plain values.
//
// PLACEHOLDER MASSING. These sizes and positions are stand-ins until the
// real site photos arrive; the scene is generated from this file alone, so
// matching the real campus means editing the numbers and materials below,
// not the code. Units are metres; x runs east, z runs south (towards the
// street), y is up. Doors face +z unless `door.side` says otherwise.

export const PLACEHOLDER = true;

export const SITE = {
  name: "Verlet Robotics",
  ground: { x0: -52, x1: 50, z0: -46, z1: 32 },
  gate: { x: 0, z: 30 },          // where every route starts
  street: { z: 13, x0: -44, x1: 42 },
  sun: { azimuth: -62, elevation: 24 },   // degrees; late afternoon from the west
};

// Materials are keys the scene knows: cladding (profiled metal), render
// (painted plaster), glass (curtain wall), brick, concrete.
export const BUILDINGS = [
  {
    id: "b-store", name: "Warehouse", x: 0, z: 0, w: 24, d: 16, floors: [{ h: 7.5 }],
    walls: "cladding", tint: "#9aa0a6", roof: "membrane",
    door: { side: "front", at: -10.2, w: 3.2, h: 4.2, kind: "roller" },
    windows: { strip: { y: 6.2, h: 0.9, every: 3.6, w: 2.6, sides: ["back", "front"] } },
    fixed: true,   // racks are generated from the location tree in place
  },
  {
    id: "b-office", name: "Office", x: -31, z: 2, w: 18, d: 13, floors: [{ h: 3.8 }],
    walls: "render", tint: "#e9e5dc", roof: "membrane",
    door: { side: "front", at: 0, w: 2.2, h: 2.6, kind: "glass" },
    windows: { band: { y: 0.9, h: 2.3, every: 2.2, w: 1.8, sides: ["front", "east", "west"] } },
  },
  {
    id: "b-lab", name: "Hardware lab", x: 29, z: -1, w: 15, d: 12, floors: [{ h: 4.4 }],
    walls: "brick", tint: "#b4836a", roof: "membrane",
    door: { side: "front", at: -3, w: 2.0, h: 2.6, kind: "glass" },
    windows: { band: { y: 1.1, h: 2.2, every: 2.6, w: 1.9, sides: ["front", "west"] } },
  },
  {
    id: "b-robotics", name: "Robotics hall", x: 3, z: -28, w: 20, d: 14, floors: [{ h: 6 }],
    walls: "cladding", tint: "#4a4e55", roof: "sawtooth",
    door: { side: "front", at: 0, w: 4.0, h: 4.5, kind: "roller" },
    windows: { strip: { y: 4.2, h: 1.2, every: 3.4, w: 2.8, sides: ["front", "east"] } },
  },
  {
    id: "b-field", name: "Dispatch bay", x: -27, z: -22, w: 11, d: 9, floors: [{ h: 4.2 }],
    walls: "concrete", tint: "#a7a39b", roof: "membrane",
    door: { side: "front", at: 1, w: 3.0, h: 3.4, kind: "roller" },
    windows: { strip: { y: 3.0, h: 0.6, every: 2.6, w: 1.8, sides: ["east"] } },
  },
];

// Paths drawn on the ground, as polylines (route-finding walks these).
export const PATHS = [
  [[0, 30], [0, 13]],
  [[-44, 13], [42, 13]],
  [[-10.2, 13], [-10.2, 8.6]],
  [[-31, 13], [-31, 9.1]],
  [[26, 13], [26, 5.6]],
  [[16, 13], [16, -19], [3, -19], [3, -20.4]],
  [[-17, 13], [-17, -15.6], [-26, -15.6], [-26, -16.9]],
];

// Trees and parking are dressing only.
export const TREES = [
  [-46, 20], [-40, 22], [-22, 24], [-14, 21], [12, 22], [22, 24], [34, 21], [44, 18],
  [-46, -8], [-46, -30], [-40, -40], [-14, -38], [18, -38], [30, -30], [42, -16], [44, -36],
  [38, 8], [-20, -32], [-8, -40], [8, 26], [-30, 26], [46, 0],
];
export const PARKING = { x: 32, z: 22, w: 18, d: 9, bays: 8 };

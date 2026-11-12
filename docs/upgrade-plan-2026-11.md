# Upgrade plan: the spatial stockroom (November 2026)

A plan to take the `/space` prototype from "a 3D view next to the panels" to the
place where the inventory work actually happens. Its companion is a working, UI-only
mockup in [`mockup/`](../mockup/README.md). Run it with `npm run dev`; it needs no
Docker, no API and no database.

## 1. Where the product is today

Read from this repo, not assumed:

- **Web:** Next.js 16 App Router, React 19, Tailwind v4, Three.js 0.187, now at the repo root
  and UI-only on `main` (`5d8ec9a`): with `API_URL` unset, `src/lib/api/mock/` answers every call. The 3D part
  is `src/components/spatial/` (`office-scene.ts` 955 lines, `workspace.tsx`
  1,336 lines). The floor is a 20 × 14 m sample room with low, standard and tall
  shelves. Layout edits live only in browser storage
  (`docs/spatial-workspace-design.md`, "Persistence and limits").
- **Rules** live in the Express API and are mirrored in `src/lib/roles.ts`:
  admin / stock_manager / member, with cashier as a fallback role. These include
  the return ceiling, damaged vs lost, admin-only repair, admin-attributed undo,
  and payment approval for admin or cashier (`docs/SPEC.md` §3–7).
- **Money:** MTN MoMo disbursement with a monthly budget and per-user daily,
  monthly and per-transaction limits. It runs in mock mode when `MOMO_*` is unset.
- **Known gaps in the prototype:** the scene is rebuilt after committed geometry
  changes, prototype edits never reach the API, routing is a fixed sample grid,
  and "very large floors still need further performance work".

## 2. What the upgrade changes

| # | Change | Why | Where it lands |
|---|--------|-----|----------------|
| U1 | **Real-scale stockroom**: pallet racks → bays → levels → bins, generated from the `locations` tree. A bin's address *is* its leaf path (`Rack A › Bay 2 › Level 3 › Bin A-2-3-R`). | Stock only lives in leaf locations (SPEC §2). The 3D tree and the data tree should be the same tree. | `office-scene.ts` → split into `scene/racks.ts`, `scene/bins.ts`; layout read from `GET /locations` |
| U2 | **Instanced everything + one label atlas.** Uprights, beams, decks, boxes, totes and labels are each a single `InstancedMesh`. All bin labels are cells of one canvas texture, redrawn only when that bin's stock changes. | 72 bins render in about 43 draw calls (measured in the mockup). That keeps "very large floors" within the ≤150 draw-call budget on an Intel UHD laptop. | `scene/label-atlas.ts` |
| U3 | **Guided route from the entrance.** Search → the floor draws an animated path to the bin → the camera rises to show the whole path, then walks into the aisle. | The core flow is "find an item → identify its box → see where it is → act" (spatial doc). The route makes step 3 physical. | `lib/spatial/route.ts` (pure, testable), ribbon shader in scene |
| U4 | **Aisle-true camera.** Bin focus stands in the aisle against the opposite rack at about 30°, never inside the next rack. On phones, framing shifts up so the subject clears the bottom sheet. | Today's camera backs off on a straight line. Real aisles are about 2.3 m deep. | `lib/spatial/camera.ts` |
| U5 | **Act in place.** Take / Return / Damaged / Lost / Repair on the bin, with the SPEC rules enforced and their messages shown inline. Taking units drops them out of the box; returns fall in. Labels and counters update from the ledger. | Feedback at the object, not in a distant table. Rules unchanged, still enforced by the API. | `box-inspector.tsx` → `bin-inspector.tsx`; calls existing `/movements` endpoints |
| U6 | **Ledger console.** Live, append-only feed with activity chips, "mine only", "show reversed", undo-as-reversal, CSV and print. | The report already exists (`GET /movements/report`). This gives it a live face. | `reports/` + new `ledger-console.tsx` |
| U7 | **Condition heatmap.** Bins tinted by % operational, next to the room → category → item report. | Puts the condition report on the floor, where the broken stock physically is. | Reuses `equipment-audit.ts` / condition report data |
| U8 | **Expenses beside the room.** Budget ring, the signed-in user's limits, request form with receipt photo, approve-and-disburse timeline (requested → approved → disbursing → successful). | Same MoMo flow, but approval state is visible as it moves. | `payments-client.tsx` restyle; no API change |
| U9 | **Role entry.** Admin / Stock manager / Member picker that re-cuts permissions (the mockup's stand-in for sign-in). In the real app the session decides. | Makes the 0040 capability split (`roles.ts`) visible in demos and QA. | Demo mode only |
| U10 | **Finish:** favicon, meta + OG image, 404, reduced-motion (instant cuts), WebGL-refused fallback still, render loop paused when the tab is hidden, pixel ratio capped at 1.5. | House quality bar. | `app/layout.tsx`, `not-found.tsx` |

Out of scope for this plan: indoor positioning, RoomPlan capture, multi-user layout
sync. These are listed as not implemented in the spatial doc and stay that way here.

## 2b. The campus (added after review, 2026-11-09)

The stockroom becomes one building on a **campus of departments**: Stockroom, Software, Hardware,
Robotics station and the Field Kit bay, each mapped to the app's real top-level areas (Main Warehouse +
Main Store, Office, Lab A, Robotics Lab, Field Kit).

| # | Change | Notes |
|---|--------|-------|
| C1 | **Site from one data file.** `mockup/src/site.js` holds every building's footprint, height, floors, walls, windows, door and roof as plain values. | **Placeholder massing** until the real site photos arrive; matching the real campus is a data edit. |
| C2 | **Departments, people, leads.** Each person has a home department; one person may lead it. Sign-in flies you into yours. | New data, prototype-only (`saved on this device`); no API change proposed yet. |
| C3 | **Customisation by role.** Admin: departments (name, colour), who belongs where, leads, any layout. Lead: their department's layout. Member: their own desk. | Mirrors the 0040 capability split: authority over a room is not authority over money. |
| C4 | **Furniture kit + edit mode.** Desks, benches, 3D printers, shelving, robot cells, AMRs, server racks, meeting tables, whiteboards, plants, flight cases, pallets. Drag on a 25 cm snap, rotate, duplicate, remove, undo; walls, doorways, racks and other furniture are respected. | Shelving that holds stock (Shelf A/B, Front desk, Rack 1, Lab A, Field Kit) is linked to its location and can't be removed while stocked. |
| C5 | **Transitions.** The campus assembles on load (walls rise, roofs drop with a bounce); opening a building lifts its roof away and cuts the near walls down; switching departments arcs the camera across the site with the department's name as a title card; new furniture drops in and settles. | All rest under reduced motion (instant cuts). |
| C6 | **Campus-wide find.** Items, people, departments and box codes; the route runs from the gate along the site paths to the building door and inside to the shelf. | |

## 3. References (Awwwards WebGL collection, November 2026)

Patterns and techniques only. No code, copy or assets are taken.

| Site | What it does | What we borrow |
|------|--------------|----------------|
| [Cybear World](https://www.cybear.it/world) (Cybear) | Storybook 3D world with a world map from above, free roaming *or* a guided route following coins to a gate | **U3/U1:** the overview that descends into the room, and "free roam or follow the route". Search turns on the guided path; orbit stays free. |
| [Tinkeroll](https://layernative.com/tinkeroll/) (Layer Native) | Tilt-board marble game; the marble drops into a hole as the page transition | **U5:** physical cause and effect. Units pop out of the box on Take and fall back in on Return, with gravity and a bounce. |
| [Infinity Socks](https://theinfinitysocks.com/) (Georgi Tsonev) | Scroll-film product page with a 3D sock, "Team Kit Room" configurator and shot-clock navigation | **Chapter meter:** the numbered 01–05 header counter and progress bar. **U2:** an object built from real-world surface detail (procedural cardboard, punched uprights, wire decks). |
| [Ethiack](https://ethiack.com/) (Bürocratik) | Agentic pentest site with a `console.log` element, code-snippet animation and an interactive diagram | **U6:** the ledger as a live monospace console where new rows flash in. |
| [Continuance](https://continuance.ai/) (Hobro Digital) | Novel site that opens with device/character selection, then re-cuts the experience | **U9:** pick who you are first; the room and its permissions follow. |
| [No Mercy Michel](https://no.merci-michel.com) (Merci Michel) | Bold titles and playful UI components in a Three.js world | **Typography over the scene:** the large serif intro set directly on the live 3D floor, with springy UI components. |

Interaction references already cited in `docs/spatial-workspace-design.md` (Autodesk
viewer, ArcGIS Indoors, Matterport) still apply to camera controls.

## 4. Performance budget (owner's laptop: i3-1215U, Intel UHD, ChromeOS)

Measured in the mockup at 1440 × 900 on virgl/ANGLE: **~80 draw calls and ~66k triangles for
the whole campus** (43–60 inside a single department), 60 fps while moving, and **0 frames while idle**
(render-on-demand). Software GL (SwiftShader, llvmpipe) drops to a low-power profile.

- 1 shadow-casting directional light (2048 map, PCF), hemisphere fill, RoomEnvironment IBL at 0.3
- Light pools under the lamps and window shafts are additive planes, not lights
- Contact shadows under racks are baked into the floor-decal texture
- Lamps and purlins hide when the camera is above the roof; the roof is one-sided
- Pixel ratio capped at 1.5; `requestAnimationFrame` stops while `document.hidden`

## 5. Phasing into the app

1. **P1, data-driven floor (U1, U2).** Generate racks and bins from `/locations`.
   Keep `office-scene.ts`'s picking and drag; replace per-object meshes with instancing.
   Tests: placement and atlas cell maths in `lib/spatial/*.test.ts`.
2. **P2, find and act (U3–U5).** Route and camera as pure modules with tests;
   the bin inspector calls the existing movement endpoints; errors come from the API.
3. **P3, ledger, condition and expenses (U6–U8).** UI on existing endpoints, no schema change.
4. **P4, finish (U10)** plus the ten-checks gate, screenshots at 1440 and 390, and Lighthouse.

Each phase is a PR on its own branch. `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build` must pass.

## 6. Open questions for the team

- Real rack dimensions and bin counts per room (the mockup uses 3 racks × 3 bays × 4
  levels × 2 bins at 2.4 m bays).
- Where the entrance is in each real room, for routing.
- Whether totes vs cartons should be a location attribute (`location_kind` exists).

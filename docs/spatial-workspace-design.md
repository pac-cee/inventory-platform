# Spatial inventory workspace

The primary flow is **find an item → identify its box → see where it is → act**.
The `/space` route is the authenticated home. The map stays visible beside native
inventory/location/directions panels and embedded administrative workflows.

## Navigation and presentation

The floating sidebar follows the existing Ego Platform design: inset rounded
shell, neutral active rows, restrained pink actions, DM Sans and serif identity.
All permitted sections remain visible. Desktop navigation collapses; phones show
a two-row navigation grid. Details reserve canvas space rather than covering it.
Legacy routes retain their authentication and role checks inside the workspace.

## Selection, camera and previews

- Clicking a shelf zooms to its front; clicking a box zooms closer while retaining
  its shelf and surrounding room. Ordinary selection does not hide geometry.
- Focus is straight-on in the selected object's local orientation. Preview camera
  snapshots follow the object when it moves or rotates and frame tall shelves.
- Explicit Preview shelf / Inspect box isolates the requested object. Preview
  target and selection are separate. Leaving preview restores the prior camera.
- Drag to orbit, scroll/pinch to zoom; rotation has no horizontal turn limit.
  Editing objects does not trigger automatic focus on every placement click.
- Box hit testing takes priority over broad shelf volumes and excludes decorative
  outlines without a complete shelf/box address.

## Building a local plan

Edit plan has Add and Objects tabs. Low, standard and tall shelves plus tables
can be added, dragged, nudged, rotated, copied and removed. Half-metre snapping
keeps placement predictable. Shelf levels grow while occupied levels are retained.
Existing locations removed from the plan retain their backend inventory records.
Walls, glass and plants are currently fixed scenery; furniture overlap prevention
and editable architectural geometry are not implemented.

Arrange boxes uses four positions per level. Drag a box in 3D, drag within the
shelf grid, or select a box and tap its destination. Occupied positions swap boxes
without changing their contents. Command/Ctrl+C/V and visible Copy/Paste controls
use an in-session workspace clipboard. Copies have fresh IDs and no stock. Text
fields keep normal browser copy/paste behavior.

## Stock and QR interactions

Each box has a label, item list, quantity controls and downloadable QR label.
The item handler provides catalogue additions, quantity-based moves between boxes,
and picking stock out. Drag onto a 3D box or named destination; tap controls provide
an alternative on phones. Moves conserve quantities and reject unavailable stock.
These local actions do not create loans or assign a borrower.

Scan supports camera, image upload and pasted inventory QR codes. Item codes lead
to shelf/box/quantity selection; local box codes open the matching saved box.
Camera access is cleaned up when the reader closes. Actual phone camera hardware
has not been tested.

## Persistence and limits

Save locally stores user-scoped layout, box and stock drafts in browser storage.
Undo keeps up to 30 editing snapshots in the current session. Prototype changes
are not written to the inventory API, synchronized between devices or shared with
other users. Browser data must be retained to keep local drafts.

Floor-plan import accepts PNG/JPEG/WebP up to 5 MB and 8192 pixels per side. It is
a session-only reference texture, not reconstructed geometry. The sample room is
20 × 14 metres. Sample directions use a half-metre grid from a fixed entrance,
accounting for current furniture and shelf footprints. Blocked paths return no
route. Importing a reference image disables sample routing. There is no live indoor
positioning, verified real-office routing or iPhone RoomPlan capture integration.

## Implementation

- `src/components/spatial/workspace.tsx`: local state and interaction orchestration.
- `office-scene.ts`: dynamically loaded Three.js scene, camera, picking and drag.
- `workspace-tools.tsx`: sidebar and bounded tool panels.
- `box-inspector.tsx`, `shelf-arranger.tsx`, `item-transfer-panel.tsx`: stock UI.
- `scan-panel.tsx`, `explore-panels.tsx`: scan, find and route workflows.
- `src/lib/spatial/`: pure placement, quantity, persistence, routing and camera logic.

The WebGL scene is reconstructed after committed geometry changes; direct dragging
moves the existing group and commits on release. Pixel ratio is capped and rendering
pauses in a hidden document. Very large floors still need further performance work.

## Validation

Run `npm test`, `npx tsc --noEmit`, and `npm run build -- --webpack` in `web`.
The feature suite contains 265 tests at this checkpoint. Browser checks exercised
login, visible navigation, shelf/box selection and zoom, preview, repeated rotation,
placement, copy/paste, undo, saved reload, item drag/drop and stock conservation,
plus 1440px desktop and 390px phone layouts. Mobile checks use browser emulation.
Payment workflows were displayed, not submitted.

All changed TypeScript/JavaScript files pass ESLint with zero warnings. Full-repo
lint still reports pre-existing issues in unchanged payment routes and legacy form
components; this branch does not suppress or modify those checks.

Webpack is a verified build fallback: Turbopack intermittently failed resolving
Google-font resources. Development output is `.next-local`, separate from `.next`
production builds. Both are excluded from lint/version control.

## Design references

The dominant visual reference is the local Ego Platform floating sidebar and UI
components. Interaction research informed contextual panels and explicit camera
controls rather than automatic isolation on selection:

- [Autodesk model viewer](https://help.autodesk.com/cloudhelp/ENG/Coord-Models/files/get-started-with-models/Model_Coord_Models_In_Viewer.html)
- [Autodesk viewing toolbars](https://help.autodesk.com/cloudhelp/ENU/Collab-Home/files/using-the-viewer/Design_Collab_Viewing_Toolbar.html)
- [ArcGIS Indoors routing preparation](https://doc.arcgis.com/en/indoors/latest/viewer/prepare-a-map-for-indoor-viewer.htm)
- [Matterport spatial tags and tours](https://support.matterport.com/s/article/What-is-Matterport-Cloud-Workshop-and-3D-Showcase?language=en_US)

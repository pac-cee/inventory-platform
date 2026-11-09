# Verlet campus — upgrade mockup

A UI-only, clickable mockup of the upgrade in
[`docs/upgrade-plan-2026-11.md`](../docs/upgrade-plan-2026-11.md): the whole site as a 3D
campus of departments, with the stockroom racks inside the warehouse.
No Docker, no API, no database. The mock data lives in your browser.

```bash
cd mockup
npm install
npm run dev        # http://127.0.0.1:5190
```

`npm run build` writes a static site to `mockup/dist/` (`npm run preview` serves it).

## What you can do

1. **Sign in as a person** from the app's fixtures. Your department opens and the camera flies in.
2. **Campus.** Hover a building to peek under its roof, or click it to open it: the roof lifts
   away and the near walls cut down. Switching departments arcs the camera across the site.
3. **Customise.** The admin renames and recolours departments, assigns people and sets leads.
   A lead arranges their department (add, drag, rotate, duplicate, remove, undo). A member moves
   their own desk. All of it is "Prototype · saved on this device".
4. **Find.** Press `/` for items, people, departments or box codes. The route runs from the gate
   to the shelf, in whichever building it is.
5. **Act.** Take, Return, Damaged, Lost or Repair, under the rules in `docs/SPEC.md`.
6. **Ledger, Expenses, Condition**, as in the app, across every department.

Keys: `1`–`5` switch chapters, `/` searches, `Esc` steps back. In edit mode `R` rotates,
`D` duplicates, `Del` removes and `Ctrl/⌘+Z` undoes. **Reset** in the footer restores the fixtures.

## Data

`src/fixtures.js` is generated from the app's own mock data:

```bash
node scripts/import-fixtures.mjs   # reads ../src/lib/api/mock/fixtures.json
```

That covers people, locations, the 28 items, stock, the 38-row ledger, payments and the
2,500,000 RWF budget. Racks A–C in the warehouse and the parts on them are sample shelving,
marked "sample". Departments, assignments and layouts are new in this mockup.

## The site

`src/site.js` describes every building as values: footprint, height, floors, walls, windows,
door and roof. **The current shapes are placeholder massing** until they are matched to site photos.
Matching the real campus means editing that file, not the scene code.

## Files

- `src/site.js` — buildings, paths, trees, parking
- `src/data.js` — store, permissions, departments and layouts, stock and payment rules
- `src/scene.js` — Three.js campus: buildings and transitions, warehouse racks, instanced
  furniture and people, routes, drag editing, render-on-demand
- `src/kit.js` — furniture kit as merged vertex-coloured geometry (one draw call per kind)
- `src/textures.js` — procedural concrete, cardboard, steel, brick, render, grass, site plan, labels
- `src/main.js` — sign-in, chapters, panels, edit mode, search, overlays

# Inventory interface reference

The inventory web app follows Ego Platform's existing design system. Source
references are the sibling project's `frontend/ops/src/app/globals.css`,
`components/floating-sidebar.tsx` and `components/ui/button.tsx`.

| Decision | Application |
| --- | --- |
| Floating sidebar | Inset desktop navigation, 28px outer corners, persistent collapse |
| Neutral active navigation | Pink is reserved for actions and spatial selection |
| Dark surfaces | Near-black canvas, charcoal panels, legible secondary text |
| Typography | DM Sans body, restrained serif identity and headings |
| Controls | Rounded controls, visible focus, bounded scrolling, touch alternatives |
| Status | Semantic stock colors; empty and unavailable inventory remain distinct |

The final home is a spatial workspace. Its behavior, limitations and verification
are documented in [spatial-workspace-design.md](spatial-workspace-design.md).
Shared buttons, dialogs, cards, item/location details and login were adjusted to
match the same visual direction. Existing authentication and API mutations remain
in their original workflows; spatial prototype edits are browser-local.

## Local preview

The development setup used web port 3115, API port 4015 and an isolated PostgreSQL
container (`verlet-inventory-local`, port 55439). Configure ignored local environment
files using the repository setup instructions. Do not commit credentials or data.

Run the API and web development scripts in separate terminals; for the web:

```sh
cd web
npm run dev -- --port 3115
```

Node 22 is required by the web package. Build artifacts, temporary screenshots,
local environment files and browser QA scripts are not part of this branch.

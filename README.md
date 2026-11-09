# Inventory Platform — UI prototype

The web dashboard for an internal inventory and expense system, running entirely
on mock data. There's no database, no API and nothing to configure.

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign in with the prefilled details (any email and password work).

## What's in it

- **Office map**: a 3D view of the floor (three.js), with search and a plan editor
- **Inventory**: the catalog, item details, stock per location, and QR labels
- **Locations**: areas, shelves, levels and boxes, with printable box labels
- **Borrowed equipment**: who holds what, due dates and overdue loans
- **Payments**: expense requests, the monthly budget, and approval history
- **Reports**: activity, item condition, and expenses, with PDF/CSV export
- **Users**: roles, invitations and blocking

## How the mock works

Every call the app makes to its backend is answered by `src/lib/api/mock/`
from responses recorded off a real run with demo data (`fixtures.json`).
Dates are shifted so due dates and "this month" always line up with today.

- Adding, editing and deleting items, locations and people works, and stays
  until the server restarts.
- Stock actions (take, return, transfer, mark damaged) succeed but don't change
  the counts.
- Photo uploads are accepted but not shown.

To use a real backend instead, set `API_URL` to a running inventory-api
(see `.env.example`). `MOCK_API=1` or `MOCK_API=0` forces the choice.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Radix UI, three.js.

## Deploy

It deploys as-is to any Next.js host with no environment variables: import the
repo on Vercel, or use `railway.json` on Railway. Hosted mock data is shared by
every visitor and resets on each restart.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm start       # serve the production build
npm test        # unit tests (vitest)
npm run lint
```

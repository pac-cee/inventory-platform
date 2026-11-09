# Inventory Platform

A clickable prototype of an inventory and expense dashboard. It runs on its own
with built-in demo data, so you don't need a database, a server or any setup.

## Get it running

**1. Check you have Node.js 20.9 or newer**

```bash
node -v
```

If that fails or shows an older version, install the LTS release from
[nodejs.org](https://nodejs.org).

**2. Download the code**

```bash
git clone https://github.com/pac-cee/inventory-platform.git
cd inventory-platform
```

**3. Install and start**

```bash
npm install
npm run dev
```

**4. Open it**

Go to [http://localhost:3000](http://localhost:3000). The sign-in form is
already filled in, so click **Sign in**. Any email and password also work.

## Take the tour

| Where | What to try |
| --- | --- |
| **Office map** | Drag to orbit the 3D floor, scroll to zoom, switch between **3D** and **Plan**, search for an item |
| **Inventory** | Open an item to see its stock, who has it, and its history. Use **Add item** to create one |
| **Locations** | Browse areas, shelves and boxes. **Print labels** makes QR stickers for boxes |
| **Borrowed** | See who holds what and which loans are overdue. Export the list as CSV |
| **Payments** | Look through expense requests, the monthly budget and the transaction history |
| **Reports** | Activity, item condition and expenses, each exportable to PDF or CSV |
| **People** | Add someone, change a role, or block an account |

## Good to know

- **Your changes are temporary.** New or edited items, locations and people
  stay until you stop the server. Starting again brings back the original
  demo data.
- **Stock numbers don't move.** Taking, returning or transferring stock shows
  as successful but leaves the counts as they were.
- **Photos aren't kept.** Uploads go through, but no image is shown afterwards.
- **Dates stay current.** Due dates and "this month" always line up with today.

## Something not working?

- **`Port 3000 is in use`**: run `npm run dev -- -p 3001` and open
  http://localhost:3001 instead.
- **Errors during `npm install`**: check `node -v` again (step 1), then delete
  the `node_modules` folder and run `npm install` again.
- **A blank map**: the 3D view needs WebGL. Try another browser, or turn on
  hardware acceleration in your browser's settings.

## Share it online

It deploys with no settings:

1. Go to [vercel.com/new](https://vercel.com/new) and import this repository.
2. Click **Deploy**.

Everyone who opens the link shares the same demo data, and it resets whenever
the host restarts the app.

## Use real data instead

Copy `.env.example` to `.env.local` and set `API_URL` to a running
inventory-api, then restart `npm run dev`. With `API_URL` unset the app always
uses the demo data. Set `MOCK_API=1` or `MOCK_API=0` to force one or the other.

## For developers

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Radix UI and three.js.

```bash
npm run dev     # development server
npm run build   # production build
npm start       # serve the production build
npm test        # unit tests
npm run lint    # lint
```

The demo backend lives in `src/lib/api/mock/`: `index.ts` answers each request,
and `fixtures.json` holds the recorded demo responses.

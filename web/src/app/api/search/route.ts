import { NextResponse } from "next/server";
import { serverApi, ApiError } from "@/lib/api/server";
import { itemLabel } from "@/lib/item-label";
import type { StockPlace } from "@/lib/stock-summary";
import { locationPath, rankItems, rankLocations } from "@/lib/search";

interface ItemRow {
  id: string;
  type: string;
  name: string;
  model: string | null;
  sku: string | null;
  specification: string | null;
  category: string | null;
}
interface LocationRow {
  id: string;
  name: string;
  parent_id: string | null;
}

// Locations are a small, rarely-changing list and every keystroke would
// otherwise refetch them from a database that is a long way from here. A short
// per-process cache keeps typeahead snappy; a new location shows up within the
// TTL, which is fine for a suggestion list.
const LOCATION_TTL_MS = 30_000;
let locationCache: { at: number; rows: LocationRow[] } | null = null;

/**
 * Typeahead behind the topbar search box: the best few items and locations for
 * what has been typed so far. The page itself is not touched — this exists so
 * you can see a match without scrolling to a table.
 */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ items: [], locations: [] });

  try {
    const api = serverApi();
    const now = Date.now();
    const locationsPromise =
      locationCache && now - locationCache.at < LOCATION_TTL_MS
        ? Promise.resolve(locationCache.rows)
        : api.get<LocationRow[]>("/locations").then((rows) => {
            locationCache = { at: Date.now(), rows };
            return rows;
          });

    const [items, locations] = await Promise.all([
      // The API already filters on name/SKU/spec; ask for a few more than we show
      // so ranking has something to choose from.
      api.get<ItemRow[]>(`/items?search=${encodeURIComponent(q)}&limit=30`),
      locationsPromise,
    ]);

    const byId = new Map(locations.map((l) => [l.id, l]));
    const topItems = rankItems(items, q, 6);
    // Where each of those is and how many — so the dropdown can answer "do we
    // have it, and which box?". Best effort: search still works if this fails.
    const where = topItems.length
      ? await api
          .get<{ item_id: string; total: number; places: StockPlace[] }[]>(
            `/items/where?ids=${topItems.map((i) => i.id).join(",")}`,
          )
          .catch(() => [])
      : [];
    const whereById = new Map(where.map((w) => [w.item_id, w]));
    return NextResponse.json({
      items: topItems.map((i) => ({
        id: i.id,
        // One line: type · name · model. The SKU is machine-assigned, so it is a
        // matching aid shown underneath, not something to read the item by.
        name: itemLabel(i),
        sku: i.sku,
        specification: i.specification,
        category: i.category,
        total: whereById.get(i.id)?.total ?? null,
        places: whereById.get(i.id)?.places ?? [],
      })),
      locations: rankLocations(locations, q, 5).map((l) => ({
        id: l.id,
        name: l.name,
        path: locationPath(l, byId),
      })),
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status >= 500) console.error("GET /api/search failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status });
  }
}

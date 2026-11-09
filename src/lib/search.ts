/**
 * What the one search box in the topbar is pointed at.
 *
 * The box used to send every query to the overview, so searching while looking
 * at a location threw you out of it. Instead the box searches whatever the page
 * in front of you is showing, and says so in its placeholder.
 */
export type SearchScope = "all" | "items" | "locations" | "location";

/** The scope a path searches in. Unknown pages fall back to the overview. */
export function scopeForPath(pathname: string): SearchScope {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "all";
  if (path === "/items") return "items";
  if (path === "/locations") return "locations";
  // A single location searches what is inside it, not the whole catalog.
  if (/^\/locations\/[^/]+$/.test(path)) return "location";
  return "all";
}

/**
 * Where a query typed on this page should land.
 *
 * Scoped pages filter themselves in place. Anywhere else — an item's detail
 * page, reports, settings — there is nothing on screen to narrow, so the query
 * goes to the overview rather than doing nothing.
 */
export function searchTarget(pathname: string): string {
  return scopeForPath(pathname) === "all" && pathname !== "/" ? "/" : pathname;
}

/** Placeholder text, so the box states what it will actually search. */
export function placeholderFor(scope: SearchScope): string {
  switch (scope) {
    case "items":
      return "Search items…";
    case "locations":
      return "Search locations…";
    case "location":
      return "Search this location…";
    default:
      return "Search items, locations…";
  }
}

/** Said when a search matches nothing, naming the limit that caused it. */
export function noMatchMessage(scope: SearchScope, query: string): string {
  const q = query.trim();
  switch (scope) {
    case "items":
      return `No item matches “${q}”.`;
    case "locations":
      return `No location matches “${q}”.`;
    case "location":
      return `Nothing here matches “${q}”. This searches only what is in this location — its sub-locations and the items stored in it.`;
    default:
      return `No item or location matches “${q}”.`;
  }
}

/** Case-insensitive substring over the fields worth searching. */
function hit(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/** An item matches on what identifies it: type, name, model, SKU or spec. */
export function matchesItem(
  item: {
    type?: string | null;
    name: string;
    model?: string | null;
    sku?: string | null;
    specification?: string | null;
  },
  query: string,
): boolean {
  return hit(
    query,
    item.type,
    item.name,
    item.model,
    item.sku,
    item.specification,
  );
}

/** A location matches on its name — the only thing people know it by. */
export function matchesLocation(
  location: { name: string },
  query: string,
): boolean {
  return hit(query, location.name);
}

/**
 * Should the box adopt the text of the URL's `?q=`?
 *
 * The box mirrors the URL so that navigating away clears it. But while the user
 * is typing the box is the source of truth: the URL only ever holds a query
 * from a moment ago. Adopting it then is the bug that ate characters — type
 * "bamb", the page starts re-rendering, type "u", the old `?q=bamb` lands and
 * overwrites "bambu", and a moment later "bambu" is pushed and pops back in.
 */
export function shouldAdoptUrlQuery(state: {
  focused: boolean;
  urlQuery: string;
  value: string;
}): boolean {
  if (state.focused) return false;
  return state.urlQuery !== state.value;
}

/**
 * How well `text` matches `query`: 0 exact, 1 starts with it, 2 a word in it
 * starts with it, 3 contains it. Null when it does not match at all.
 */
export function matchScore(
  query: string,
  text: string | null | undefined,
): number | null {
  const q = query.trim().toLowerCase();
  const t = (text ?? "").toLowerCase();
  if (!q || !t) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/[\s\-_/.,()]+/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  return null;
}

/** Best-matching items first: a type or name hit beats model and SKU, which beat a spec hit. */
export function rankItems<
  T extends {
    name: string;
    type?: string | null;
    model?: string | null;
    sku?: string | null;
    specification?: string | null;
  },
>(items: T[], query: string, limit = 6): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const parts = [
      matchScore(query, item.name),
      matchScore(query, item.type),
      bump(matchScore(query, item.model), 1),
      bump(matchScore(query, item.sku), 1),
      bump(matchScore(query, item.specification), 2),
    ].filter((n): n is number => n !== null);
    if (parts.length) scored.push({ item, score: Math.min(...parts) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((s) => s.item);
}

function bump(n: number | null, by: number): number | null {
  return n === null ? null : n + by;
}

export function rankLocations<T extends { name: string }>(
  locations: T[],
  query: string,
  limit = 5,
): T[] {
  return locations
    .map((l) => ({ l, score: matchScore(query, l.name) }))
    .filter((x): x is { l: T; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.l.name.localeCompare(b.l.name))
    .slice(0, limit)
    .map((x) => x.l);
}

/** "Warehouse › Shelf 3" — where a location sits, so two "Level 2"s are told apart. */
export function locationPath(
  loc: { id: string; name: string; parent_id: string | null },
  byId: Map<string, { id: string; name: string; parent_id: string | null }>,
): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur: typeof loc | undefined = loc;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join(" › ");
}

/** Cuts `text` into pieces so the part that matched `query` can be emphasised. */
export function splitMatch(
  text: string,
  query: string,
): { text: string; match: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return [{ text, match: false }];
  return [
    ...(i > 0 ? [{ text: text.slice(0, i), match: false }] : []),
    { text: text.slice(i, i + q.length), match: true },
    ...(i + q.length < text.length
      ? [{ text: text.slice(i + q.length), match: false }]
      : []),
  ];
}

/** Global search always opens its own results, independent of the current page. */
export function globalSearchHref(query: string): string {
  const q = query.trim();
  return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
}

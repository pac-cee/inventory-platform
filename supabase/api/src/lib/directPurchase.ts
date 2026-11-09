/**
 * Rules for direct purchases (petty cash and other spending outside the payment
 * flow). Pure, so the arithmetic and the clean-up rules can be tested without a
 * database. See migrations/0046_direct_purchases.sql for why this exists.
 */

export const PAYMENT_METHODS = ["petty_cash", "cash", "card", "bank", "momo", "other"] as const;
export type DirectPaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface LineAmounts {
  quantity: number;
  unit_cost: number;
}

/** Round to the cent. Amounts are RWF, but the column keeps two decimals. */
export const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A line is quantity x unit cost — never typed, so it cannot disagree with itself. */
export const lineTotal = (l: LineAmounts): number => money(l.quantity * l.unit_cost);

export interface PurchaseTotals {
  subtotal: number;
  delivery: number;
  total: number;
}

/** Sum of the lines, plus delivery. */
export function purchaseTotals(lines: LineAmounts[], delivery = 0): PurchaseTotals {
  const subtotal = money(lines.reduce((sum, l) => sum + lineTotal(l), 0));
  const d = money(delivery);
  return { subtotal, delivery: d, total: money(subtotal + d) };
}

/**
 * What identifies a vendor, ignoring how it was typed: case, spaces, punctuation
 * and a trailing company word. "Atlas M&U Ltd" and "atlas m&u limited" are one
 * supplier; so are "BF Supermarket" and "bf-supermarket".
 *
 * It does NOT guess at spelling mistakes ("Nyereka teck" vs "Nyereka tech") —
 * merging those is a human decision. See {@link similarVendors}.
 */
export function vendorKey(name: string): string {
  let s = String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/&/g, "and");
  // Drop a trailing company word (any number of them: "x co ltd").
  for (;;) {
    const next = s.replace(/[\s.,]+(ltd|limited|llc|inc|plc|co|company|corp|sarl)\.?\s*$/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/[^a-z0-9]+/g, "");
}

/** Edit distance between two short strings (insert, delete, replace = 1 each). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Existing vendors that look like a typed name without being identical to it:
 * likely the same supplier spelled differently, so the form can ask "did you mean
 * Nyereka Tech?" instead of silently creating a fourth spelling. Closest first.
 */
export function similarVendors<T extends { name: string; name_key: string }>(
  typed: string,
  existing: T[],
  maxDistance = 2,
): T[] {
  const key = vendorKey(typed);
  if (key.length < 3) return [];
  return existing
    .filter((v) => v.name_key !== key)
    .map((v) => ({ v, d: editDistance(key, v.name_key) }))
    // Short names would match everything at distance 2; scale the limit to length.
    .filter(({ d, v }) => d <= Math.min(maxDistance, Math.floor(Math.min(key.length, v.name_key.length) / 3)))
    .sort((x, y) => x.d - y.d || x.v.name.localeCompare(y.v.name))
    .map(({ v }) => v);
}

/**
 * Today's date in Kigali (UTC+2) as YYYY-MM-DD. Dates in this system mean Kigali
 * days, whatever the server's own zone is.
 */
export function kigaliToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * A purchase date must be a real calendar date, not in the future (one day of
 * slack for a late-evening entry), and not absurdly old.
 */
export function checkPurchaseDate(iso: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "The purchase date must look like 2026-10-24.";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return "That date does not exist.";
  }
  if (y < 2020) return "That date is too far in the past.";
  const tomorrow = new Date(Date.parse(kigaliToday(now) + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  if (iso > tomorrow) return "A purchase cannot be dated in the future.";
  return null;
}

/**
 * One CSV cell. Quotes when needed, and defuses a leading = + - @ (a value like
 * "=HYPERLINK(...)" typed into a vendor name would otherwise run as a formula
 * when finance opens the export in Excel).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(",");

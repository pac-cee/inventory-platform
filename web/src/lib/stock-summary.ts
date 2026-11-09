/**
 * What a search result says about stock: how many there are and where.
 *
 * "Do we have a Raspberry Pi, and which box is it in?" should be answerable from
 * the dropdown without opening the item.
 */
export interface StockPlace {
  location_id: string;
  path: string;
  kind: string;
  label: string | null;
  quantity: number;
}

export interface StockSummary {
  /** Short, right-hand text: "12 in stock" / "None in stock". */
  count: string;
  /** Where the most units are, in words; null when there is nothing on a shelf. */
  where: string | null;
  inStock: boolean;
}

/** A box reads as its label ("USB-A to C cables"), anything else as its path. */
export function placeText(p: StockPlace): string {
  if (p.kind === "box") return p.label ? `Box “${p.label}” · ${p.path}` : `Box · ${p.path}`;
  return p.path;
}

export function stockSummary(total: number, places: StockPlace[], placeCount = places.length): StockSummary {
  if (total <= 0 || places.length === 0) return { count: "None in stock", where: null, inStock: false };
  const top = placeText(places[0]);
  const more = placeCount - 1;
  return {
    count: `${total} in stock`,
    where: more > 0 ? `${top} (+${more} more place${more === 1 ? "" : "s"})` : top,
    inStock: true,
  };
}

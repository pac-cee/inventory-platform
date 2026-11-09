/**
 * How an item reads on one line (the search dropdown, loan and reservation
 * lists). Same rule as the API's lib/itemLabel.ts: type · name · model, leaving
 * out a name that only repeats the type and the 'Unspecified' placeholder model.
 */
export const UNSPECIFIED_MODEL = "Unspecified";

export function itemLabel(item: { type?: string | null; name: string; model?: string | null }): string {
  const type = item.type || item.name;
  const parts = [type];
  if (item.name && item.name !== type) parts.push(item.name);
  if (item.model && item.model !== UNSPECIFIED_MODEL) parts.push(item.model);
  return parts.join(" · ");
}

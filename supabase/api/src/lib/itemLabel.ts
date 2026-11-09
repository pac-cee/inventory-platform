/**
 * How an item reads on one line — in the borrowed list, reservations, reminder
 * emails and box contents.
 *
 * An item is identified by its TYPE ("Cable"), NAME ("USB-A to C") and MODEL
 * ("1m"), with a machine-assigned SKU (0039). On one line that is
 * "Cable · USB-A to C · 1m". Two things are left out so it does not stutter:
 * a name that just repeats the type, and the 'Unspecified' model that 0039
 * backfilled onto items nobody has edited yet.
 */
export const UNSPECIFIED_MODEL = "Unspecified";

/** SQL for the label of the items row aliased `alias` (add `as something` yourself). */
export const itemLabelSql = (alias = "i"): string =>
  `concat_ws(' · ', ${alias}.type, case when ${alias}.name <> ${alias}.type then ${alias}.name end, nullif(${alias}.model, '${UNSPECIFIED_MODEL}'))`;

/** The same rule in code, for places that already hold the three fields. */
export function itemLabel(item: { type: string; name: string; model?: string | null }): string {
  const parts = [item.type];
  if (item.name && item.name !== item.type) parts.push(item.name);
  if (item.model && item.model !== UNSPECIFIED_MODEL) parts.push(item.model);
  return parts.join(" · ");
}

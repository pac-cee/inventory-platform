/**
 * An item's number within a location (0036) — what people point at on a shelf.
 *
 * Numbering starts at 1 in every location, so the same item can be #2 in one
 * room and #7 in another. Rows written before 0036 have no number until they
 * next move, hence the null handling here rather than at every call site.
 */

/** How a number reads in a list. An em dash where there isn't one yet. */
export function slotLabel(slotNo: number | null | undefined): string {
  return typeof slotNo === "number" && slotNo > 0 ? `#${slotNo}` : "—";
}

/**
 * Order items the way the location reads: by their number, then by name.
 * Unnumbered rows sort last rather than jumping to the front on a null.
 */
export function bySlotThenName(
  a: { slot_no?: number | null; name?: string | null },
  b: { slot_no?: number | null; name?: string | null },
): number {
  const rank = (s: number | null | undefined) =>
    typeof s === "number" && s > 0 ? s : Number.MAX_SAFE_INTEGER;
  return rank(a.slot_no) - rank(b.slot_no) || (a.name ?? "").localeCompare(b.name ?? "");
}

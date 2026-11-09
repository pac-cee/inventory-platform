/** What sort of place a location is (0041). A `box` is a labelled container with a QR code. */
export type LocationKind = "area" | "shelf" | "level" | "box";

export const LOCATION_KINDS: LocationKind[] = ["area", "shelf", "level", "box"];

export const KIND_LABELS: Record<LocationKind, string> = {
  area: "Area / room",
  shelf: "Shelf",
  level: "Level",
  box: "Box (container)",
};

/**
 * The store is laid out  Area > Shelf > Level > Box.  A box is always the last step: it
 * sits on a level and holds nothing below it. The API enforces the same rules; this only
 * keeps the forms from offering choices it would refuse. `parentKind` null = top level.
 */
export function kindsAllowedUnder(parentKind: string | null | undefined): LocationKind[] {
  switch (parentKind ?? null) {
    case null:
      return ["area"];
    case "area":
      return ["shelf"];
    case "shelf":
      return ["level"];
    case "level":
      return ["box"];
    default:
      return []; // a box holds nothing below it
  }
}

/** Whether "add a sub-location here" makes sense for a place of this kind. */
export function canHoldSubLocations(kind: string | null | undefined): boolean {
  return kindsAllowedUnder(kind ?? "area").length > 0;
}

/** What to offer when editing a place that already is `current`: what fits there, and always itself. */
export function kindsForEdit(current: LocationKind, parentKind: string | null | undefined): LocationKind[] {
  const fits = kindsAllowedUnder(parentKind);
  return fits.includes(current) ? fits : [...fits, current];
}

/**
 * A place made before places had types: stored as "area" although it sits inside a shelf, a
 * level or a box. (An area inside another AREA is fine: a "Shelves" grouping inside a room.)
 * These are the old levels that still need their type set.
 */
export function isOlderUntypedPlace(kind: string | null | undefined, parentKind: string | null | undefined): boolean {
  return (kind ?? "area") === "area" && !!parentKind && parentKind !== "area";
}

/** Short badge text for lists; null for ordinary places so they stay uncluttered. */
export function kindBadge(kind: string | null | undefined, label?: string | null): string | null {
  if (kind !== "box") return null;
  return label ? `Box · ${label}` : "Box";
}

/**
 * What the form posted, as the API wants it. `label` only means something for a
 * box, so it is dropped (not sent as empty) for any other kind. Returns only
 * the fields the form actually carried.
 */
export function kindFields(formData: FormData): { kind?: LocationKind; label?: string | null } {
  const raw = String(formData.get("kind") ?? "").trim();
  if (!raw) return {};
  const kind = (LOCATION_KINDS as string[]).includes(raw) ? (raw as LocationKind) : undefined;
  if (!kind) return {};
  const label = String(formData.get("label") ?? "").trim();
  return { kind, label: kind === "box" ? label || null : null };
}

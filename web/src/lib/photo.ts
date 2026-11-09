/**
 * Where a picture's bytes come from.
 *
 * An upload is served by the API and needs the session token, which an <img>
 * cannot send — so it goes through the Next proxy at /api/<kind>/<id>/photo.
 * Otherwise the browser fetches the external link itself. An upload wins over a
 * link, matching the API, so a stale link never shows under a newer file.
 */
export function photoSrc(
  kind: "items" | "locations",
  id: string | undefined,
  hasPhoto: boolean | undefined,
  url: string | null | undefined,
): string | null {
  if (hasPhoto && id) return `/api/${kind}/${id}/photo`;
  return url && url.trim() ? url : null;
}

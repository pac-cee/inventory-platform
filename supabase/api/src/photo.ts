import type { Response } from "express";
import { z } from "zod";

// Shared by items (0034) and locations (0036): both store a picture the same
// way, so the validation and the serving live here rather than twice.

/** ~1.4MB of base64, so roughly a 1MB image after a client-side resize. */
export const MAX_PHOTO_CHARS = 1_400_000;

/** A `data:image/...;base64,...` string, size-capped. */
export const photoDataUrl = z
  .string()
  .trim()
  .regex(/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/, {
    message: "Upload a PNG, JPEG, WebP or GIF image.",
  })
  .max(MAX_PHOTO_CHARS, "That image is too large — keep it under about 1MB.");

/**
 * A link to an image hosted elsewhere. http(s) only: a data: URI here would
 * defeat the point of the separate column by putting the image back in the row.
 */
export const photoLink = z
  .string()
  .trim()
  .url("Enter a full image link starting with http:// or https://")
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "Only http:// or https:// links are allowed.",
  });

/** The body of a photo upload. */
export const photoBody = z.object({ data_url: photoDataUrl });

/**
 * Answer a photo request: decode an upload to real image bytes, otherwise
 * redirect to the external link. Returns false when there is no picture at all,
 * so the caller can pick the 404 wording.
 */
export function sendPhoto(
  res: Response,
  row: { photo_data: string | null; photo_url: string | null },
): boolean {
  if (row.photo_data) {
    const [meta, b64] = row.photo_data.split(",", 2);
    const type = meta.slice(5).replace(";base64", "");
    res.setHeader("Content-Type", type);
    // Immutable per upload: a new upload replaces the row, so a short cache is
    // safe and keeps repeat views off the database.
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(b64, "base64"));
    return true;
  }
  if (row.photo_url) {
    res.redirect(302, row.photo_url);
    return true;
  }
  return false;
}

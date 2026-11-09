/** Longest edge of a stored photo, in pixels. Enough to recognise an item. */
export const MAX_EDGE = 900;

/** JPEG quality for the resized image. */
export const QUALITY = 0.82;

/**
 * Read a picked file and return a small JPEG data URI.
 *
 * A phone camera photo is 3–8MB, which is far more than anyone needs to tell
 * one cable from another — and it would land in the database as base64. Resizing
 * in the browser means the big file never leaves the machine.
 *
 * Transparency is lost (JPEG), which is the right trade for photographs.
 */
export function resizeToDataUrl(
  file: File,
  maxEdge = MAX_EDGE,
  quality = QUALITY,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("That file is not an image."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image could not be opened."));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not process that image."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

"use client";

import { useState } from "react";
import { ImageOff, ImageIcon } from "lucide-react";

export { photoSrc } from "@/lib/photo";

/**
 * The picture panel shared by items (0034) and locations (0036).
 *
 * A plain <img>, not next/image: the URL is arbitrary and typed in by an admin,
 * so it cannot be allow-listed in next.config the way next/image requires.
 * A dead link falls back to a placeholder instead of a broken-image icon.
 *
 * `object-contain`, not cover: the photo is here so the thing can be
 * recognised, and cropping removes exactly the part that distinguishes it.
 */
export function Photo({
  src,
  alt,
  subject,
  height = "h-64",
}: {
  src: string | null;
  alt: string;
  /** "item" or "location" — only used in the empty/broken wording. */
  subject: string;
  /** Tailwind height class, so a page can give the photo more room. */
  height?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-2 px-5 py-4 text-muted-foreground">
        {broken ? (
          <>
            <ImageOff className="size-8" aria-hidden />
            {/* The browser fetches the link directly, so the usual causes are a
                page rather than a file, or a host that blocks hotlinking. */}
            <p className="max-w-xs text-center text-xs">
              That image link could not be loaded. It must point straight at an
              image file — a link ending in .jpg or .png — not at a web page.
              Some sites also block other sites from using their images; if in
              doubt, upload the file instead.
            </p>
          </>
        ) : (
          <>
            <ImageIcon className="size-8" aria-hidden />
            <p className="text-xs">No photo for this {subject} yet.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onError={() => setBroken(true)}
        className={`${height} w-full rounded-lg bg-muted/40 object-contain`}
      />
    </div>
  );
}

/**
 * Small square for lists.
 *
 * The slot is always `size` square, picture or not: a list where some rows are
 * tall and others short is harder to read than one with no pictures at all. An
 * empty slot draws nothing — no placeholder, no border — it only holds space.
 */
export function Thumb({
  src,
  alt,
  size = 64,
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <span style={{ width: size, height: size }} className="shrink-0" aria-hidden />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-md bg-muted/40 object-contain"
    />
  );
}

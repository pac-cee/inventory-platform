"use client";

import { Photo, Thumb, photoSrc } from "@/components/dashboard/photo";

/** The item's picture, beside the QR code on the detail page. */
export function ItemPhoto({
  url,
  alt,
  itemId,
  hasPhoto,
}: {
  url: string | null;
  alt: string;
  /** When the item has an upload, the bytes come from the API, not the link. */
  itemId?: string;
  hasPhoto?: boolean;
}) {
  return <Photo src={photoSrc("items", itemId, hasPhoto, url)} alt={alt} subject="item" />;
}

/** Small square for item lists — nothing at all when the item has no photo. */
export function ItemThumb({
  url,
  alt,
  itemId,
  hasPhoto,
  size = 64,
}: {
  url: string | null;
  alt: string;
  itemId?: string;
  hasPhoto?: boolean;
  size?: number;
}) {
  return <Thumb src={photoSrc("items", itemId, hasPhoto, url)} alt={alt} size={size} />;
}

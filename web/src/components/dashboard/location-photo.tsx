"use client";

import { Photo, Thumb, photoSrc } from "@/components/dashboard/photo";

/**
 * The location's picture (0036).
 *
 * Every level gets one — a room and a shelf inside it each have their own — so
 * someone looking for a thing can recognise the place before reading the name.
 */
export function LocationPhoto({
  url,
  alt,
  locationId,
  hasPhoto,
}: {
  url: string | null;
  alt: string;
  locationId?: string;
  hasPhoto?: boolean;
}) {
  return (
    <Photo src={photoSrc("locations", locationId, hasPhoto, url)} alt={alt} subject="location" />
  );
}

/** Small square for location lists — nothing when the location has no photo. */
export function LocationThumb({
  url,
  alt,
  locationId,
  hasPhoto,
  size = 64,
}: {
  url: string | null;
  alt: string;
  locationId?: string;
  hasPhoto?: boolean;
  size?: number;
}) {
  return <Thumb src={photoSrc("locations", locationId, hasPhoto, url)} alt={alt} size={size} />;
}

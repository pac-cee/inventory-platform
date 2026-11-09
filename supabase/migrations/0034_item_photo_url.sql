-- 0034: a picture per item, so people can recognise what they are looking for.
--
-- Two ways in, because both are useful:
--   photo_url   — a link to an image hosted elsewhere.
--   photo_data  — an image uploaded from the user's machine, held as a data URI.
--
-- Uploads win over the link when both are set.
--
-- The reason these are separate columns rather than one: GET /items returns the
-- whole catalog, and an uploaded image inlined there would grow every list
-- response by the size of every photo. The list selects photo_url and a
-- has_photo flag and never touches photo_data; the bytes are fetched one item
-- at a time from GET /items/:id/photo.
--
-- Idempotent: safe to re-run.

alter table items add column if not exists photo_url text;
alter table items add column if not exists photo_data text;

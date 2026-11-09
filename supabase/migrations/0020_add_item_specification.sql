-- 0020 — Item specification field (distinct from the free-form description).
-- Idempotent: safe to run on an existing database.

alter table items
  add column if not exists specification text;

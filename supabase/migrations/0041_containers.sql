-- =============================================================================
-- 0041_containers.sql
-- =============================================================================
-- Containers ("boxes"). The hardware team keeps small parts in labelled plastic
-- boxes on shelf levels; a box is a LOCATION that holds items, so the existing
-- tree and per-location stock already model it. What was missing is knowing
-- WHICH locations are boxes, what each box is for, and a stable code for the
-- QR sticker on it.
--
--   kind      what sort of place this is: area | shelf | level | box.
--             Default 'area', so every existing location is unchanged and
--             nothing is converted automatically — managers mark the boxes.
--   label     what a box is for ("USB-A to C cables"). Free text, optional.
--   qr_token  the code printed on a box's sticker. Assigned by the API the first
--             time a location becomes a box and never changed after, so a
--             printed label keeps working however the box is later edited.
--
-- Additive and re-runnable; no rows are changed.
-- =============================================================================

alter table public.locations add column if not exists kind text not null default 'area';
alter table public.locations add column if not exists label text;
alter table public.locations add column if not exists qr_token text;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_kind_check' and conrelid = 'public.locations'::regclass) then
    alter table public.locations
      add constraint locations_kind_check check (kind in ('area', 'shelf', 'level', 'box'));
  end if;
  -- A box without a code could not have a sticker.
  if not exists (select 1 from pg_constraint where conname = 'locations_box_has_token' and conrelid = 'public.locations'::regclass) then
    alter table public.locations
      add constraint locations_box_has_token check (kind <> 'box' or qr_token is not null);
  end if;
end
$do$;

create unique index if not exists locations_qr_token_key
  on public.locations (qr_token) where qr_token is not null;

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute 'alter table test.locations add column if not exists kind text not null default ''area''';
  execute 'alter table test.locations add column if not exists label text';
  execute 'alter table test.locations add column if not exists qr_token text';

  if not exists (select 1 from pg_constraint where conname = 'locations_kind_check' and conrelid = 'test.locations'::regclass) then
    execute 'alter table test.locations add constraint locations_kind_check check (kind in (''area'', ''shelf'', ''level'', ''box''))';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_box_has_token' and conrelid = 'test.locations'::regclass) then
    execute 'alter table test.locations add constraint locations_box_has_token check (kind <> ''box'' or qr_token is not null)';
  end if;
  execute 'create unique index if not exists locations_qr_token_key on test.locations (qr_token) where qr_token is not null';
end
$do$;

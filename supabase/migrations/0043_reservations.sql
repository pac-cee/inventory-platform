-- =============================================================================
-- 0043_reservations.sql
-- =============================================================================
-- Reserve: hold N units of an item at a location for a window of dates, so they
-- are there when the person comes for them.
--
-- A reservation is made for someone (`user_id`) by someone (`requested_by`,
-- different when a manager books on a person's behalf). It is approved on
-- creation when stock allows (checked in the API), so there is no pending state.
-- Whether it is upcoming, active or expired is DERIVED from its dates, so
-- nothing has to run to expire one. Only the outcomes are stored:
--   approved   - standing (upcoming, active, or lapsed unused)
--   cancelled  - withdrawn by the person or a manager
--   fulfilled  - the person took the units (see fulfilled_movement_id)
--
-- Additive and re-runnable; no existing rows change.
-- =============================================================================

create table if not exists public.reservations (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references public.items(id) on delete cascade,
  location_id           uuid not null references public.locations(id),
  user_id               uuid not null references public.users(id),
  requested_by          uuid not null references public.users(id),
  quantity              integer not null check (quantity > 0),
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  status                text not null default 'approved' check (status in ('approved', 'cancelled', 'fulfilled')),
  fulfilled_movement_id uuid references public.stock_movements(id),
  note                  text,
  created_at            timestamptz not null default now(),
  cancelled_at          timestamptz,
  constraint reservations_window_check check (ends_at > starts_at)
);

-- "What is reserved for this item here, around now" is the hot query.
create index if not exists reservations_item_loc_idx on public.reservations (item_id, location_id, status, starts_at, ends_at);
create index if not exists reservations_user_idx on public.reservations (user_id, status);

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute $sql$
    create table if not exists test.reservations (
      id                    uuid primary key default gen_random_uuid(),
      item_id               uuid not null references test.items(id) on delete cascade,
      location_id           uuid not null references test.locations(id),
      user_id               uuid not null references test.users(id),
      requested_by          uuid not null references test.users(id),
      quantity              integer not null check (quantity > 0),
      starts_at             timestamptz not null,
      ends_at               timestamptz not null,
      status                text not null default 'approved' check (status in ('approved', 'cancelled', 'fulfilled')),
      fulfilled_movement_id uuid references test.stock_movements(id),
      note                  text,
      created_at            timestamptz not null default now(),
      cancelled_at          timestamptz,
      constraint reservations_window_check check (ends_at > starts_at)
    )
  $sql$;
  execute 'create index if not exists reservations_item_loc_idx on test.reservations (item_id, location_id, status, starts_at, ends_at)';
  execute 'create index if not exists reservations_user_idx on test.reservations (user_id, status)';
end;
$do$;

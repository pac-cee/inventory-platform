-- =============================================================================
-- 0047_push_foundation.sql
-- =============================================================================
-- Groundwork for push notifications (Phase 11): who has which phone, what each
-- manager wants to be told, and a queue of messages waiting to go out.
--
--   device_tokens        one row per phone that signed in and allowed alerts.
--                        `token` is the push address (FCM); unique, so a phone
--                        handed to someone else moves to the new user.
--   notification_prefs   per person: alert each return or a daily summary, and
--                        quiet hours (Kigali time). Rows are optional; defaults
--                        apply when there is none. Edited from Phase 12 settings.
--   notification_outbox  messages to send. One row per (event, recipient, kind),
--                        so retrying the job or the request never sends twice.
--                        `send_after` holds a message back (quiet hours);
--                        `sent_at` is set once handled; `attempts`/`error` track
--                        failures so a bad row cannot retry forever.
--
-- Additive and re-runnable. Nothing existing changes; with no tokens registered
-- or no sender configured, nothing is ever sent.
-- =============================================================================

create table if not exists public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

create table if not exists public.notification_prefs (
  user_id     uuid primary key references public.users(id) on delete cascade,
  mode        text not null default 'each' check (mode in ('each', 'daily')),
  quiet_start time not null default '20:00',
  quiet_end   time not null default '07:30',
  updated_at  timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('return')),
  movement_id uuid references public.stock_movements(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  unique (movement_id, user_id, kind)
);
create index if not exists notification_outbox_due_idx on public.notification_outbox (send_after) where sent_at is null;

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute $sql$
    create table if not exists test.device_tokens (
      id           uuid primary key default gen_random_uuid(),
      user_id      uuid not null references test.users(id) on delete cascade,
      token        text not null unique,
      platform     text not null check (platform in ('ios', 'android')),
      created_at   timestamptz not null default now(),
      last_seen_at timestamptz not null default now()
    )
  $sql$;
  execute $sql$
    create table if not exists test.notification_prefs (
      user_id     uuid primary key references test.users(id) on delete cascade,
      mode        text not null default 'each' check (mode in ('each', 'daily')),
      quiet_start time not null default '20:00',
      quiet_end   time not null default '07:30',
      updated_at  timestamptz not null default now()
    )
  $sql$;
  execute $sql$
    create table if not exists test.notification_outbox (
      id          uuid primary key default gen_random_uuid(),
      kind        text not null check (kind in ('return')),
      movement_id uuid references test.stock_movements(id) on delete cascade,
      user_id     uuid not null references test.users(id) on delete cascade,
      title       text not null,
      body        text not null,
      data        jsonb not null default '{}'::jsonb,
      send_after  timestamptz not null default now(),
      sent_at     timestamptz,
      attempts    integer not null default 0,
      error       text,
      created_at  timestamptz not null default now(),
      unique (movement_id, user_id, kind)
    )
  $sql$;
end;
$do$;

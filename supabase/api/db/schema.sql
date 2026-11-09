-- =============================================================================
-- Neon PostgreSQL schema for the Inventory API.
-- =============================================================================
-- Consolidated, self-hosted replacement for the former Supabase project.
-- Authentication (formerly GoTrue) now lives in the `users` + `refresh_tokens`
-- tables and is issued/verified by the API itself. Authorization (formerly RLS)
-- is enforced in the Express layer — there are intentionally NO row-level
-- policies here. The stock engine and the corporate-transaction creator are
-- kept as Postgres functions (ported verbatim from the old migrations) because
-- they encode load-bearing business logic + error contracts.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;      -- case-insensitive email

-- =========================================================================
-- users: auth identity (replaces Supabase auth.users)
-- =========================================================================
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  email_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- refresh_tokens: rotating refresh tokens, one row per issued token.
-- session_id groups a login "session" so logout(scope=local) revokes just
-- that session's family; blocking a user revokes all their sessions.
-- =========================================================================
create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  session_id uuid not null,
  token_hash text not null unique,      -- sha256(refresh_token)
  revoked boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists refresh_tokens_user_idx on refresh_tokens (user_id);
create index if not exists refresh_tokens_session_idx on refresh_tokens (session_id);


-- =========================================================================
-- password_resets: single-use, expiring reset tokens (E2).
-- The raw token is sent by email; only its sha256 hash is stored. A row is
-- invalidated on use (used_at set) or after expires_at, and is scoped to the
-- user so a leaked token can't be replayed against another account.
-- =========================================================================
create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,      -- sha256(raw token)
  expires_at timestamptz not null,
  used_at timestamptz,                  -- null until consumed (single-use)
  created_at timestamptz not null default now(),
  -- 0038: the password the requester proposed, bcrypt-hashed, applied only when
  -- they confirm from their inbox. Null for the link-style flow, where the
  -- password is chosen after the link is opened.
  new_password_hash text,
  denied_at timestamptz                 -- set when the owner says it wasn't them
);

create index if not exists password_resets_pending_idx
  on password_resets (user_id) where used_at is null and denied_at is null;
create index if not exists password_resets_user_idx on password_resets (user_id);

-- =========================================================================
-- profiles: one row per user, with display name + role/limits.
-- =========================================================================
create table if not exists profiles (
  id uuid primary key references users(id) on delete cascade,
  full_name text,
  -- 0040 added 'stock_manager': runs the warehouse (items, locations,
  -- movements, stock reports) but never approves a payment — the payment
  -- guards accept only admin/cashier, so exclusion is structural.
  role text not null default 'member'
    check (role in ('member', 'admin', 'stock_manager')),
  created_at timestamptz not null default now(),
  blocked boolean not null default false,
  -- 0037: self-registered accounts wait for an admin. Defaults to 'approved'
  -- so admin-created accounts and every pre-existing row stay usable; only
  -- POST /auth/signup writes 'pending'.
  approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
  approved_at timestamptz,
  approved_by uuid references profiles(id) on delete set null,
  has_payment_permission boolean not null default false,
  -- 0040: the same warehouse rights as stock_manager, granted to an individual
  -- without changing their role. Mirrors has_payment_permission.
  can_manage_inventory boolean not null default false,
  fallback_role text not null default 'none' check (fallback_role in ('cashier', 'none')),
  daily_limit numeric not null default 0.00 check (daily_limit >= 0),
  monthly_limit numeric not null default 0.00 check (monthly_limit >= 0),
  per_transaction_limit numeric not null default 0.00 check (per_transaction_limit >= 0)
);

-- Admins open the pending list whenever someone registers, and it is a tiny
-- slice of the table.
create index if not exists profiles_pending_approval_idx
  on profiles (created_at) where approval_status = 'pending';

-- Finding the warehouse staff is a common admin screen query (0040).
create index if not exists profiles_inventory_idx
  on profiles (role, can_manage_inventory);

-- =========================================================================
-- locations
-- =========================================================================
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_id uuid references locations(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Sub-locations (0021): a location may nest one level under a parent "category".
-- Deleting a parent promotes its children to top-level (on delete set null).
-- Idempotent so re-applying schema.sql to an existing database adds the column.
alter table locations add column if not exists parent_id uuid references locations(id) on delete set null;
create index if not exists locations_parent_idx on locations (parent_id);

-- Archived locations (0029). A location that has ledger history or payments can
-- never be hard-deleted (the movement ledger is append-only and references it),
-- so "remove" archives it instead: hidden from GET /locations and every picker,
-- but still resolvable when the report renders an old movement.
alter table locations add column if not exists archived_at timestamptz;
create index if not exists locations_archived_idx on locations (archived_at);

-- Containers (0041): which locations are labelled boxes, what a box is for, and
-- the code on its QR sticker. See migrations/0041_containers.sql.
alter table locations add column if not exists kind text not null default 'area';
alter table locations add column if not exists label text;
alter table locations add column if not exists qr_token text;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_kind_check' and conrelid = 'locations'::regclass) then
    alter table locations add constraint locations_kind_check check (kind in ('area', 'shelf', 'level', 'box'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_box_has_token' and conrelid = 'locations'::regclass) then
    alter table locations add constraint locations_box_has_token check (kind <> 'box' or qr_token is not null);
  end if;
end
$do$;
create unique index if not exists locations_qr_token_key on locations (qr_token) where qr_token is not null;

-- Names are unique among SIBLINGS, not globally (0030). Global uniqueness meant
-- a "Shelf 3" anywhere blocked a "Shelf 3" under any other room; the UI shows
-- the full path, so same-named locations under different parents are fine. Two
-- partial indexes because NULLs compare as distinct — without the second one,
-- top-level names would have no uniqueness at all. Archived rows are excluded,
-- so removing a location frees its name.
alter table locations drop constraint if exists locations_name_key;
drop index if exists locations_name_active_key;
create unique index if not exists locations_name_per_parent_key
  on locations (parent_id, name) where archived_at is null and parent_id is not null;
create unique index if not exists locations_name_top_level_key
  on locations (name) where archived_at is null and parent_id is null;

-- Location photo (0036). Same shape as the item photo: a link to an image
-- hosted elsewhere, or an upload held as a data URI, with the upload winning
-- when both are set. GET /locations returns every location, so the list reads
-- photo_url and a has_photo flag and never touches photo_data.
alter table locations add column if not exists photo_url text;
alter table locations add column if not exists photo_data text;

-- =========================================================================
-- item_sku_prefix — the letter part of a machine-assigned SKU (0039).
--
-- MUST MIRROR `typePrefix` in src/lib/sku.ts: 3+ words -> initials; 2 words ->
-- 3 letters + 2 letters; 1 word -> vowels squeezed out but a leading one kept,
-- falling back to the plain word when that leaves under three letters.
-- tests/routes/item-sku.test.ts asserts the two agree, so a change here that
-- is not made there fails the suite rather than silently issuing SKUs the app
-- would not have chosen.
-- =========================================================================
create or replace function item_sku_prefix(txt text) returns text as $$
  with w as (
    select array_remove(
             string_to_array(
               btrim(
                 regexp_replace(
                   translate(
                     lower(coalesce(txt, '')),
                     'áàâäãåéèêëíìîïóòôöõúùûüýÿñç',
                     'aaaaaaeeeeiiiiooooouuuuyync'
                   ),
                   '[^a-z]+', ' ', 'g')),
               ' '),
             '') as words
  )
  select case
           -- No letters at all.
           when coalesce(array_length(words, 1), 0) = 0 then 'itm'
           -- Three or more words: the initials, read as an abbreviation.
           when array_length(words, 1) >= 3 then (
             select string_agg(left(word, 1), '' order by ord)
               from unnest(words[1:5]) with ordinality as t(word, ord))
           -- Two words: three letters off the first, two off the second.
           when array_length(words, 1) = 2 then left(words[1], 3) || left(words[2], 2)
           -- One word: vowels squeezed out, a leading one kept...
           when length(sq.squeezed) >= 3 then left(sq.squeezed, 5)
           -- ...unless that leaves too little to read ("Fan" -> "fan").
           else left(words[1], 3)
         end
    from w,
         lateral (
           select case
                    when left(words[1], 1) ~ '^[aeiou]$' then left(words[1], 1)
                    else ''
                  end
                  || regexp_replace(coalesce(words[1], ''), '[aeiou]', '', 'g') as squeezed
         ) sq;
$$ language sql immutable;

-- =========================================================================
-- items — a type ("Cable"), a name, a model, and a machine-assigned SKU.
-- Before 0039 the type was called `name` and the name was hand-typed into
-- `sku`. The free-text `specification` still distinguishes variants.
-- =========================================================================
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  -- 0039 renamed the two identity columns into what they always meant. What
  -- kind of thing this is ("Cable") — was `name`.
  type text not null,
  -- What this particular item is called — was hand-typed into `sku`.
  name text not null,
  -- Model designation (0039). Required; existing rows were backfilled
  -- 'Unspecified' and an admin edits them from there.
  model text not null default 'Unspecified',
  -- Machine-assigned (0039): vrlt-<prefix of the type>-<running number under
  -- that prefix>, e.g. the three Cables are vrlt-cbl-001..003. Never typed —
  -- see src/lib/sku.ts. QR codes encode the id, not this, so reissuing a SKU
  -- does not invalidate a printed code.
  sku text not null unique,
  specification text,
  -- Container packaging (0020): individual units packed in one container
  -- (box/pallet/crate); 1 = loose units. quantity is always in units.
  units_per_container integer not null default 1,
  -- Package items (0027): when set, stock is counted in WHOLE packages and the
  -- contents are NOT tracked. quantity is a package count; UI shows "5 <label>s".
  package_label text,
  -- Condition-report grouping (0033): free text, e.g. "Computer Laptop",
  -- "Cables", "Camera lens". Deliberately not a lookup table — 0022 dropped
  -- `categories` and items stayed plain name + sku + specification.
  category text,
  -- Item photo (0034). Two ways in: a link to an image hosted elsewhere, or an
  -- upload held as a data URI. Uploads win when both are set. Kept in separate
  -- columns because GET /items returns the whole catalog — the list reads
  -- photo_url and a has_photo flag and never touches photo_data.
  photo_url text,
  photo_data text,
  created_at timestamptz not null default now(),
  finishable boolean not null default false
);

-- =========================================================================
-- item_stock: current balance per (item, location). Written only by the
-- apply_stock_movement trigger below, never directly.
-- =========================================================================
create table if not exists item_stock (
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid not null references locations(id) on delete restrict,
  quantity integer not null default 0 check (quantity >= 0),
  -- Damaged units that stay part of the total but aren't accessible. Destroy
  -- moves units quantity -> damaged; total (capacity) is unchanged.
  damaged integer not null default 0 check (damaged >= 0),
  capacity integer not null default 0,
  -- Optional display label for containers at this location (0020): "box",
  -- "pallet", "crate". UI computes containers = quantity / units_per_container.
  container_label text,
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id)
);

-- The item's number within this location (0036). Items are identified globally
-- by SKU, but on a shelf people point at "number 3", so each (item, location)
-- pair gets a small integer that stays put for as long as the item does.
-- Numbering restarts per location: the same item can be #2 here and #7 there.
alter table item_stock add column if not exists slot_no integer;
create unique index if not exists item_stock_slot_no_key
  on item_stock (location_id, slot_no) where slot_no is not null;

-- Assigned by trigger, not by the API: item_stock rows are only ever written by
-- apply_stock_movement, so whatever creates the row gets a number. The advisory
-- lock serialises two items first arriving in the same location, which would
-- otherwise read the same max() and collide on the index above.
create or replace function assign_item_slot_no()
returns trigger
language plpgsql
as $$
begin
  if new.slot_no is null then
    perform pg_advisory_xact_lock(hashtext('item_stock_slot' || new.location_id::text));
    select coalesce(max(slot_no), 0) + 1 into new.slot_no
      from item_stock where location_id = new.location_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_item_stock_insert on item_stock;
create trigger on_item_stock_insert
  before insert on item_stock
  for each row execute function assign_item_slot_no();

-- =========================================================================
-- low_stock_alerts: records which (item, location) pairs have already been
-- alerted on, so the checker emails admins ONCE per low-stock event instead
-- of spamming on every scan. When stock recovers above threshold the row is
-- deleted, so a future drop re-alerts. (E4)
--
-- Defined AFTER items/locations: its FKs point at them, and on a genuinely
-- empty database a forward reference here fails outright.
-- =========================================================================
create table if not exists low_stock_alerts (
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  last_alerted_at timestamptz not null default now(),
  primary key (item_id, location_id)
);

-- =========================================================================
-- item_suggestions (0035): a change worth making to an item that is NOT
-- damaged — "runs fine, but it should have more RAM".
--
-- Separate from stock_movements because a suggestion moves no stock. The
-- condition report reads faults and suggestions together: what is broken, and
-- what is worth doing anyway.
-- =========================================================================
create table if not exists item_suggestions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  note text not null,
  kind text not null default 'upgrade'
    check (kind in ('upgrade', 'replace', 'maintenance', 'other')),
  units integer check (units is null or units > 0),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id) on delete set null,
  resolution text
);
create index if not exists item_suggestions_open_idx
  on item_suggestions (item_id, location_id) where resolved_at is null;
create index if not exists item_suggestions_item_idx on item_suggestions (item_id);

-- =========================================================================
-- stock_movements: append-only ledger. item_id cascades (0004); reason,
-- capacity_delta, reversal_of added in 0009.
-- =========================================================================
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid not null references locations(id),
  user_id uuid not null references users(id),
  delta integer not null,
  note text,
  created_at timestamptz not null default now(),
  reason text not null default 'take'
    check (reason in ('take','return','initial','finish','destroyed','lost','adjust','undo','repair','transfer','reassign')),
  -- Who physically recorded the movement. Usually the same as user_id, but when
  -- an admin attributes damage/loss to a holder, user_id is the holder and
  -- recorded_by is the admin — so only an admin can later undo it.
  recorded_by uuid references users(id),
  capacity_delta integer not null default 0,
  -- Moves units between accessible (quantity) and damaged: destroy = -delta /
  -- +damaged_delta; repair = +delta / -damaged_delta. Total (capacity) untouched.
  damaged_delta integer not null default 0,
  reversal_of uuid references stock_movements(id),
  -- Condition report (0033). A 'destroyed' row is a FAULT: `note` says what is
  -- wrong ("batteries died") and `recommendation` says what to do about it
  -- ("Replace those batteries"). A 'repair' row sets `resolves` to the fault it
  -- cleared, so repairing one of several distinct faults shortens the right
  -- part of the condition sentence.
  recommendation text,
  resolves uuid references stock_movements(id),
  constraint stock_movements_changes_something check (delta <> 0 or capacity_delta <> 0 or damaged_delta <> 0)
);
create index if not exists stock_movements_user_idx on stock_movements (user_id, created_at desc);
create index if not exists stock_movements_item_idx on stock_movements (item_id, created_at desc);
create index if not exists stock_movements_resolves_idx on stock_movements (resolves)
  where resolves is not null;
create index if not exists stock_movements_faults_idx on stock_movements (item_id, location_id)
  where reason = 'destroyed';

-- Due dates for takes (0042). The ledger is append-only, so a take's expected
-- return date lives in its own table, one row per take that has a date.
create table if not exists loan_due_dates (
  movement_id                 uuid primary key references stock_movements(id) on delete cascade,
  expected_return_at          timestamptz not null,
  original_expected_return_at timestamptz not null,
  set_by                      uuid references users(id),
  updated_at                  timestamptz not null default now()
);
create index if not exists loan_due_dates_due_idx on loan_due_dates (expected_return_at);

-- Loan reminders (0044): what the reminder job has already emailed, so running it
-- more than once a day never repeats a message. See migrations/0044_loan_reminders.sql.
create table if not exists loan_reminders (
  movement_id uuid not null references stock_movements(id) on delete cascade,
  kind        text not null,
  sent_on     date not null default current_date,
  primary key (movement_id, kind)
);
create table if not exists loan_digests (
  sent_on date primary key
);

-- Reservations (0043): hold N units of an item at a location for a window of
-- dates. Upcoming/active/expired is derived from the dates; only outcomes are
-- stored (approved / cancelled / fulfilled). See migrations/0043_reservations.sql.
create table if not exists reservations (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references items(id) on delete cascade,
  location_id           uuid not null references locations(id),
  user_id               uuid not null references users(id),
  requested_by          uuid not null references users(id),
  quantity              integer not null check (quantity > 0),
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  status                text not null default 'approved' check (status in ('approved', 'cancelled', 'fulfilled')),
  fulfilled_movement_id uuid references stock_movements(id),
  note                  text,
  created_at            timestamptz not null default now(),
  cancelled_at          timestamptz,
  constraint reservations_window_check check (ends_at > starts_at)
);
create index if not exists reservations_item_loc_idx on reservations (item_id, location_id, status, starts_at, ends_at);
create index if not exists reservations_user_idx on reservations (user_id, status);

-- Stock engine (ported verbatim from 0009). Applies delta to quantity and
-- capacity_delta to the ceiling, enforcing the invariants. Errors use errcode
-- 23514 which the API maps to HTTP 422.
create or replace function apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  current_qty integer;
  cap integer;
  current_damaged integer;
  new_qty integer;
  new_cap integer;
  new_damaged integer;
begin
  select quantity, capacity, damaged into current_qty, cap, current_damaged
    from item_stock
   where item_id = new.item_id and location_id = new.location_id;

  if not found then
    if new.delta < 0 or new.damaged_delta < 0 then
      raise exception 'Not enough stock to take.' using errcode = '23514';
    end if;
    insert into item_stock (item_id, location_id, quantity, damaged, capacity, updated_at)
    values (
      new.item_id, new.location_id, new.delta, new.damaged_delta,
      greatest(new.delta + new.damaged_delta, new.capacity_delta), now()
    );
    return new;
  end if;

  new_qty := current_qty + new.delta;
  new_cap := cap + new.capacity_delta;
  new_damaged := current_damaged + new.damaged_delta;

  if new_cap < 0 then
    raise exception 'Total stock cannot go below zero.' using errcode = '23514';
  end if;
  if new_qty < 0 then
    raise exception 'Not enough stock: only % available.', current_qty using errcode = '23514';
  end if;
  if new_damaged < 0 then
    raise exception 'Cannot repair more than is damaged (% damaged).', current_damaged using errcode = '23514';
  end if;
  -- Accessible + damaged units are both physically present; the rest of the
  -- total (capacity) is checked out. Present units can't exceed the total.
  if new_qty + new_damaged > new_cap then
    raise exception 'That exceeds the stock at this location (% max here).', new_cap using errcode = '23514';
  end if;

  update item_stock
     set quantity = new_qty, capacity = new_cap, damaged = new_damaged, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  return new;
end;
$$;

drop trigger if exists on_stock_movement_insert on stock_movements;
create trigger on_stock_movement_insert
  after insert on stock_movements
  for each row execute function apply_stock_movement();

-- =========================================================================
-- corporate_transactions + transaction_products + monthly_budgets
-- =========================================================================
create table if not exists monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  allocated_amount numeric not null check (allocated_amount >= 0),
  remaining_amount numeric not null check (remaining_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_year_month unique (year, month)
);

create table if not exists corporate_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  recipient_phone text,
  -- Who a BK mobile-money payment is for (0045); null on older payments.
  recipient_name text,
  amount numeric not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  momo_ref text,
  receipt_base64 text,
  location_id uuid references locations(id) on delete restrict,
  created_at timestamptz not null default now(),
  failure_reason text,
  item_photo_base64 text,
  budget_id uuid references monthly_budgets(id) on delete set null,
  is_stocked boolean not null default false,
  payment_method text not null default 'momo',
  payment_metadata jsonb,
  ebm_drive_file_id text
);
create index if not exists corporate_transactions_user_idx on corporate_transactions(user_id, created_at desc);
create index if not exists corporate_transactions_created_idx on corporate_transactions(created_at desc);

create table if not exists transaction_products (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references corporate_transactions(id) on delete cascade,
  name text not null,
  description text,
  -- Item fields carried through so an approved purchase creates a catalog item
  -- with the same shape as items added directly. `type` and `model` were added
  -- in 0039 and are nullable because older rows predate them — the API falls
  -- back to the product name and 'Unspecified'. `sku` is kept for history but
  -- no longer seeds the item's SKU, which is machine-assigned now.
  sku text,
  type text,
  model text,
  specification text,
  quantity integer not null check (quantity > 0),
  price numeric not null check (price >= 0),
  item_photo_base64 text
);

-- Atomic transaction creator (ported from 0015, updated by 0031/0032 to add
-- payment_metadata and fix the transaction_products column name). Kept as a
-- function so the parent + child inserts stay in one statement.
create or replace function create_corporate_transaction(
  p_user_id uuid,
  p_recipient_phone text,
  p_amount numeric,
  p_location_id uuid,
  p_receipt_base64 text,
  p_products jsonb,
  p_payment_metadata jsonb default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_tx_id uuid;
  v_prod jsonb;
begin
  insert into corporate_transactions (
    user_id, recipient_phone, amount, location_id, receipt_base64, payment_metadata, status
  ) values (
    p_user_id, p_recipient_phone, p_amount, p_location_id, p_receipt_base64, p_payment_metadata, 'pending'
  )
  returning id into v_tx_id;

  for v_prod in select * from jsonb_array_elements(p_products) loop
    insert into transaction_products (
      transaction_id, name, description, sku, type, model, specification, quantity, price, item_photo_base64
    ) values (
      v_tx_id,
      (v_prod->>'name')::text,
      (v_prod->>'description')::text,
      (v_prod->>'sku')::text,
      -- 0039: carried so an approved purchase can create a properly shaped
      -- catalog item. Null for older clients; the API falls back on completion.
      (v_prod->>'type')::text,
      (v_prod->>'model')::text,
      (v_prod->>'specification')::text,
      (v_prod->>'quantity')::integer,
      (v_prod->>'price')::numeric,
      (v_prod->>'image_base64')::text
    );
  end loop;

  return v_tx_id;
end;
$$;

-- =========================================================================
-- Performance indexes (0019_additional_perf_indexes).
--
-- These were added by migration only, so every existing database has them but
-- anything built from this file alone did not — including the test schema, and
-- any future fresh environment. Mirrored here so a fresh database and a
-- migrated one are structurally identical.
-- =========================================================================
create index if not exists transaction_products_transaction_id_idx
  on transaction_products (transaction_id);
create index if not exists corporate_transactions_location_idx
  on corporate_transactions (location_id);
create index if not exists corporate_transactions_user_status_created_idx
  on corporate_transactions (user_id, status, created_at desc);
create index if not exists items_type_idx on items (type);
create index if not exists items_name_idx on items (name);
create index if not exists items_sku_idx on items (sku);
create index if not exists items_category_idx on items (category);
-- Two items may share a name only when the type or the model differs. All
-- three are NOT NULL, so this actually bites (a nullable column would not).
create unique index if not exists items_type_name_model_key
  on items (type, name, model);
create index if not exists stock_movements_item_location_idx
  on stock_movements (item_id, location_id, created_at desc);
create index if not exists stock_movements_user_item_idx
  on stock_movements (user_id, item_id, created_at desc);
create index if not exists item_stock_location_idx on item_stock (location_id);

-- =========================================================================
-- 0046 direct purchases (petty cash / outside the payment flow). See
-- migrations/0046_direct_purchases.sql for the reasoning.
-- =========================================================================
create table if not exists vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_key   text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists vendors_name_key_idx on vendors (name_key);

create table if not exists direct_purchases (
  id                uuid primary key default gen_random_uuid(),
  purchased_on      date not null,
  vendor_id         uuid references vendors(id) on delete restrict,
  -- Finance's own category ("Hardware / Tools", "Office Supplies"...). Free text
  -- on purpose: these are accounting buckets, not inventory categories.
  category          text not null,
  justification     text,
  -- Names, not user ids: the people who buy things are not all app users.
  purchased_by_name text not null,
  purchased_by_id   uuid references profiles(id) on delete set null,
  paid_by_name      text not null,
  payment_method    text not null default 'petty_cash'
                    check (payment_method in ('petty_cash', 'cash', 'card', 'bank', 'momo', 'other')),
  receipt_ref       text,
  delivery_cost     numeric(14,2) not null default 0 check (delivery_cost >= 0),
  notes             text,
  recorded_by       uuid not null references profiles(id) on delete restrict,
  source            text not null default 'app' check (source in ('app', 'import')),
  created_at        timestamptz not null default now(),
  -- A purchase is never deleted; a mistaken one is voided with a reason.
  voided_at         timestamptz,
  voided_by         uuid references profiles(id) on delete set null,
  void_reason       text
);
create index if not exists direct_purchases_date_idx   on direct_purchases (purchased_on desc);
create index if not exists direct_purchases_vendor_idx on direct_purchases (vendor_id);

create table if not exists direct_purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references direct_purchases(id) on delete cascade,
  position     integer not null,
  description  text not null,
  quantity     integer not null check (quantity > 0),
  unit_cost    numeric(14,2) not null check (unit_cost >= 0),
  -- true = this line becomes stock (item_id + location_id say which and where);
  -- false = a consumable: recorded for finance, never added to the shelves.
  stock_in     boolean not null default false,
  item_id      uuid references items(id) on delete set null,
  location_id  uuid references locations(id) on delete set null,
  check (not stock_in or location_id is not null)
);
create index if not exists direct_purchase_lines_purchase_idx on direct_purchase_lines (purchase_id, position);

-- Push foundation (0047): phones, alert preferences and the outbox of messages waiting to
-- go out. See migrations/0047_push_foundation.sql.
create table if not exists device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on device_tokens (user_id);

create table if not exists notification_prefs (
  user_id     uuid primary key references users(id) on delete cascade,
  mode        text not null default 'each' check (mode in ('each', 'daily')),
  quiet_start time not null default '20:00',
  quiet_end   time not null default '07:30',
  updated_at  timestamptz not null default now()
);

create table if not exists notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('return')),
  movement_id uuid references stock_movements(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
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
create index if not exists notification_outbox_due_idx on notification_outbox (send_after) where sent_at is null;


-- =============================================================================
-- 0046_direct_purchases.sql
-- =============================================================================
-- Purchases made OUTSIDE the payment flow (petty cash, cash, a card): the finance
-- team's "Ad-Hoc & Direct Purchases Log". Until now these lived in a spreadsheet:
-- RWF 2.6M across 56 rows with no vendor master data, no justification column
-- that anyone enforced, no receipt number, and no way to say whether a purchase
-- is stock or a consumable (water, paper, markers).
--
-- Deliberately SEPARATE from corporate_transactions: a direct purchase moves no
-- money through the app, so it must never touch the monthly budget, the
-- disbursement code or the reconciler. It is a finished record, not a request.
--
--   vendors               one row per real supplier (name_key folds case, spaces,
--                         punctuation and "ltd/limited" so near-duplicates collide)
--   direct_purchases      the header: date, vendor, category, why, who bought, who
--                         paid, how, receipt number, delivery cost
--   direct_purchase_lines what was bought. A line may be STOCK (it creates stock
--                         in a location) or a CONSUMABLE (recorded, never stocked)
--
-- Totals are never stored: a line is quantity x unit cost and a purchase is the
-- sum of its lines plus delivery, so a record cannot disagree with itself (the
-- spreadsheet has one row where 3 x 30,664 is recorded as 91,932, not 91,992).
--
-- Additive and re-runnable. Nothing existing changes.
-- =============================================================================

create table if not exists public.vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_key   text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists vendors_name_key_idx on public.vendors (name_key);

create table if not exists public.direct_purchases (
  id                uuid primary key default gen_random_uuid(),
  purchased_on      date not null,
  vendor_id         uuid references public.vendors(id) on delete restrict,
  -- Finance's own category ("Hardware / Tools", "Office Supplies"...). Free text
  -- on purpose: these are accounting buckets, not inventory categories.
  category          text not null,
  justification     text,
  -- Names, not user ids: the people who buy things are not all app users.
  purchased_by_name text not null,
  purchased_by_id   uuid references public.profiles(id) on delete set null,
  paid_by_name      text not null,
  payment_method    text not null default 'petty_cash'
                    check (payment_method in ('petty_cash', 'cash', 'card', 'bank', 'momo', 'other')),
  receipt_ref       text,
  delivery_cost     numeric(14,2) not null default 0 check (delivery_cost >= 0),
  notes             text,
  recorded_by       uuid not null references public.profiles(id) on delete restrict,
  source            text not null default 'app' check (source in ('app', 'import')),
  created_at        timestamptz not null default now(),
  -- A purchase is never deleted; a mistaken one is voided with a reason.
  voided_at         timestamptz,
  voided_by         uuid references public.profiles(id) on delete set null,
  void_reason       text
);
create index if not exists direct_purchases_date_idx   on public.direct_purchases (purchased_on desc);
create index if not exists direct_purchases_vendor_idx on public.direct_purchases (vendor_id);

create table if not exists public.direct_purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.direct_purchases(id) on delete cascade,
  position     integer not null,
  description  text not null,
  quantity     integer not null check (quantity > 0),
  unit_cost    numeric(14,2) not null check (unit_cost >= 0),
  -- true = this line becomes stock (item_id + location_id say which and where);
  -- false = a consumable: recorded for finance, never added to the shelves.
  stock_in     boolean not null default false,
  item_id      uuid references public.items(id) on delete set null,
  location_id  uuid references public.locations(id) on delete set null,
  check (not stock_in or location_id is not null)
);
create index if not exists direct_purchase_lines_purchase_idx on public.direct_purchase_lines (purchase_id, position);

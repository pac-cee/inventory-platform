-- 0035: suggested changes to an item that is not damaged.
--
-- Faults live in stock_movements because they change stock — units move from
-- working to damaged. A suggestion changes nothing: "this laptop runs, but it
-- would be better with more RAM". Putting it in the ledger would mean inventing
-- a zero-quantity movement reason and teaching the stock trigger to ignore it.
--
-- So it gets its own table. The condition report reads both: faults explain
-- what is broken, suggestions say what is worth doing anyway, and the two meet
-- in the Recommendation column.
--
-- Idempotent: safe to re-run.

create table if not exists item_suggestions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  -- Optional: a suggestion may be about the item everywhere, or about the
  -- units held at one place.
  location_id uuid references locations(id) on delete cascade,
  -- What is suggested, e.g. "Upgrade to 16GB RAM".
  note text not null,
  -- upgrade | replace | maintenance | other — kept as free-ish text with a
  -- check, so a new kind does not need a migration to become sayable.
  kind text not null default 'upgrade'
    check (kind in ('upgrade', 'replace', 'maintenance', 'other')),
  -- How many units it applies to; null means the item generally.
  units integer check (units is null or units > 0),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set when it has been acted on or dismissed; open suggestions are the ones
  -- the report prints.
  resolved_at timestamptz,
  resolved_by uuid references users(id) on delete set null,
  resolution text
);

-- The report looks these up per item, filtered to the open ones.
create index if not exists item_suggestions_open_idx
  on item_suggestions (item_id, location_id)
  where resolved_at is null;

create index if not exists item_suggestions_item_idx on item_suggestions (item_id);

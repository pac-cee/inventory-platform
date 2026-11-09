-- 0040: a stock_manager role, and separation of duties on payment approval.
--
-- Two capabilities were tangled together in `requireAdmin`: running the
-- warehouse (items, locations, movements, stock reports) and running the money
-- and the people (users, roles, budgets, approvals). This splits them.
--
--   role = 'stock_manager'      -> runs the warehouse, never approves a payment
--   can_manage_inventory = true -> the same warehouse rights, granted to an
--                                  individual member without changing their role
--
-- Payment approval is untouched on purpose: POST /payments/resolve is guarded by
-- requireAdminOrCashier, which accepts neither of the above. The new role is
-- excluded from approving by construction rather than by a rule someone has to
-- remember to add.

begin;

-- ---------------------------------------------------------------------------
-- 1. Widen the role check. The constraint is unnamed in schema.sql, so
--    Postgres called it profiles_role_check; drop by that name and re-add.
-- ---------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('member', 'admin', 'stock_manager'));

-- ---------------------------------------------------------------------------
-- 2. The per-user grant, mirroring has_payment_permission. Default false so
--    every existing row keeps exactly the rights it has today.
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists can_manage_inventory boolean not null default false;

-- Finding the warehouse staff is a common admin screen query.
create index if not exists profiles_inventory_idx
  on profiles (role, can_manage_inventory);

commit;

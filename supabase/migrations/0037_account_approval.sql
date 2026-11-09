-- Self-registered accounts wait for an admin before they can sign in.
--
-- Verifying the email proves the address is real; it says nothing about whether
-- the person should be let into the inventory. Those are two different
-- questions, so this is a separate gate rather than a change to email_confirmed.
--
-- The default is 'approved' on purpose: every account that exists today was
-- created before this gate and must not be locked out by the migration. Only
-- POST /auth/signup writes 'pending'.
alter table profiles
  add column if not exists approval_status text not null default 'approved';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_approval_status_check'
  ) then
    alter table profiles add constraint profiles_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- Who decided, and when. Kept for the audit trail; nothing reads them to make
-- an access decision.
alter table profiles add column if not exists approved_at timestamptz;
alter table profiles add column if not exists approved_by uuid references profiles(id) on delete set null;

-- Admins open this list every time someone registers, and it is a tiny slice of
-- the table, so it is worth its own partial index.
create index if not exists profiles_pending_approval_idx
  on profiles (created_at) where approval_status = 'pending';

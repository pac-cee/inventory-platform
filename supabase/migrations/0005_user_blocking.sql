-- User blocking.
-- Adds a reversible "blocked" flag to profiles. A blocked user is denied at the
-- API on every request (see middleware/auth.ts requireAuth), so blocking takes
-- effect immediately even for an already-open session.
--
-- Only admins may change the flag. This mirrors the role guard in migration
-- 0003: the profiles_update_self policy has no column guard, so without this a
-- user could clear their own block via PATCH /profiles/me.

alter table public.profiles
  add column if not exists blocked boolean not null default false;

create or replace function public.enforce_block_change_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.blocked is distinct from old.blocked
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can block or unblock users';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_block_change on public.profiles;
create trigger profiles_enforce_block_change
  before update on public.profiles
  for each row execute function public.enforce_block_change_is_admin();

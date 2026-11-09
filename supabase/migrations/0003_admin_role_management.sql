-- Admin role management.
-- Lets admins change any user's role, while preventing ordinary users from
-- escalating their own. RLS originally only allowed users to update their own
-- profile (profiles_update_self), which both blocked admins from managing
-- others and — having no column guard — let a user set their own role.

-- Helper: is the current user an admin? SECURITY DEFINER so its internal read
-- bypasses RLS (avoids a profiles-policy-querying-profiles recursion).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Admins may update any profile (e.g. to change roles). OR'd with the existing
-- profiles_update_self policy.
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin());

-- Guard role changes: only admins may change a role. auth.uid() is null for the
-- SQL editor / service role / migrations, so the first admin can still be
-- bootstrapped there.
create or replace function public.enforce_role_change_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end;
$$;

create trigger profiles_enforce_role_change
  before update on public.profiles
  for each row execute function public.enforce_role_change_is_admin();

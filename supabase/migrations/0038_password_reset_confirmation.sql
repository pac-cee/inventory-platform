-- The person picks their new password up front; the emailed link confirms it.
--
-- The old flow emailed a link that let whoever held it choose a password. This
-- one reverses the order: the password is chosen on the site, kept here as a
-- bcrypt hash, and only applied when the owner of the inbox says yes. Denying
-- kills the request outright, so an unexpected mail is one click to shut down.
--
-- Nothing recoverable is stored: new_password_hash is bcrypt, same as
-- users.password_hash, so this table never holds a readable password.
alter table password_resets add column if not exists new_password_hash text;
alter table password_resets add column if not exists denied_at timestamptz;

-- Requests still waiting on their owner. Small and read on every confirm.
create index if not exists password_resets_pending_idx
  on password_resets (user_id) where used_at is null and denied_at is null;

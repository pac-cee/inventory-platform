-- =============================================================================
-- 0044_loan_reminders.sql
-- =============================================================================
-- Reminders about equipment that is due back (or late). The job that sends them
-- runs every hour and may run more than once a day, so it needs a record of what
-- it already sent — otherwise a person would be emailed again on every run.
--
--   loan_reminders  one row per (take, kind) that was emailed. `kind` is
--                   due_tomorrow | due_today | overdue_<days>, so each step of
--                   the schedule goes out exactly once per loan.
--   loan_digests    one row per day the managers' digest was sent.
--
-- Additive and re-runnable; no existing rows change.
-- =============================================================================

create table if not exists public.loan_reminders (
  movement_id uuid not null references public.stock_movements(id) on delete cascade,
  kind        text not null,
  sent_on     date not null default current_date,
  primary key (movement_id, kind)
);

create table if not exists public.loan_digests (
  sent_on date primary key
);

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute $sql$
    create table if not exists test.loan_reminders (
      movement_id uuid not null references test.stock_movements(id) on delete cascade,
      kind        text not null,
      sent_on     date not null default current_date,
      primary key (movement_id, kind)
    )
  $sql$;
  execute 'create table if not exists test.loan_digests (sent_on date primary key)';
end;
$do$;

-- =============================================================================
-- Which of migrations 0027-0033 does this database already have?
-- =============================================================================
-- Read-only. Paste into the Neon SQL editor for the environment you want to
-- check. There is no migration-tracking table, so this looks for the marker
-- each migration leaves behind.
--
-- Run it BEFORE apply_0027_to_0033.sql to see what is missing, and AFTER to
-- confirm every row reads OK.
-- =============================================================================

with reason_def as (
  select pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where con.conname = 'stock_movements_reason_check'
     and ns.nspname = 'public'
)
select '0027  package_label + transfer reason' as migration,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'items'
                            and column_name = 'package_label')
             and exists (select 1 from reason_def where def like '%''transfer''%')
            then 'OK' else 'MISSING' end as status
union all
select '0028  totals healed',
       case when not exists (select 1 from item_stock where capacity < quantity + damaged)
            then 'OK' else 'MISSING' end
union all
select '0029  locations.archived_at',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'locations'
                            and column_name = 'archived_at')
            then 'OK' else 'MISSING' end
union all
select '0030  location names unique per parent',
       case when exists (select 1 from pg_indexes where schemaname = 'public'
                          and indexname = 'locations_name_per_parent_key')
             and exists (select 1 from pg_indexes where schemaname = 'public'
                          and indexname = 'locations_name_top_level_key')
             and not exists (select 1 from pg_constraint con
                               join pg_class rel on rel.oid = con.conrelid
                               join pg_namespace ns on ns.oid = rel.relnamespace
                              where con.conname = 'locations_name_key' and ns.nspname = 'public')
            then 'OK' else 'MISSING' end
union all
select '0031  reassign reason',
       case when exists (select 1 from reason_def where def like '%''reassign''%')
            then 'OK' else 'MISSING' end
union all
select '0032  password_resets + low_stock_alerts',
       case when (select count(*) from information_schema.tables
                   where table_schema = 'public'
                     and table_name in ('password_resets', 'low_stock_alerts')) = 2
            then 'OK' else 'MISSING' end
union all
select '0033  condition report columns',
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public'
                     and (table_name, column_name) in (('items', 'category'),
                                                       ('stock_movements', 'recommendation'),
                                                       ('stock_movements', 'resolves'))) = 3
            then 'OK' else 'MISSING' end
order by 1;

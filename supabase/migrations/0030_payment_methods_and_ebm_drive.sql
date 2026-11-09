-- =============================================================================
-- 0030_payment_methods_and_ebm_drive.sql
-- =============================================================================
-- Updates the corporate_transactions table to support EBM receipts stored in 
-- Google Drive and introduces a payment_method column to differentiate between
-- MTN Mobile Money (momo) and Bank of Kigali (bk).
-- =============================================================================

-- ============================ public (prod) ============================

-- Add payment_method column, defaulting to momo for backward compatibility
alter table public.corporate_transactions 
  add column if not exists payment_method text not null default 'momo';

-- Add ebm_drive_file_id for storing Google Drive references
alter table public.corporate_transactions 
  add column if not exists ebm_drive_file_id text;

-- ============================ test (mirror) ============================

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'test') then
    return;
  end if;

  execute 'alter table test.corporate_transactions add column if not exists payment_method text not null default ''momo''';
  execute 'alter table test.corporate_transactions add column if not exists ebm_drive_file_id text';
end;
$do$;

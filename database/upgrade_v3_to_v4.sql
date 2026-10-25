-- SkyGate Operations v4: apply AFTER the v3 schema/migration for existing projects.
-- Receipts and WhatsApp request messages are now CLIENT-SIDE ONLY.
-- This script removes browser-account permissions to read or add deposit receipts.
-- It DOES NOT delete any existing receipt records. Back up before changing your database.
begin;

-- Remove API privileges. Anon/authenticated sessions cannot access this table.
revoke all privileges on table public.deposit_receipts from anon, authenticated;

-- Remove prior staff policies for receipt access (including older naming variants).
drop policy if exists receipts_staff_add on public.deposit_receipts;
drop policy if exists deposit_receipts_staff_read on public.deposit_receipts;
drop policy if exists receipts_staff_read on public.deposit_receipts;
drop policy if exists deposit_receipts_staff_add on public.deposit_receipts;

commit;

-- Optional administrator-only cleanup AFTER backup, if you decide to remove
-- historical receipts permanently:
-- drop table if exists public.deposit_receipts;

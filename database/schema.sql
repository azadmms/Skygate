-- SkyGate Desk / NEEX — Supabase PostgreSQL schema
-- Run in a NEW dedicated Supabase project using SQL Editor.
-- Protect customer PII: browser uses ONLY the publishable/anon key and Auth + RLS.
-- Do not store client trading passwords here.

create schema if not exists private;

create table if not exists public.staff_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check(role in ('admin','operator')),
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check(length(trim(full_name)) between 1 and 100),
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mt5_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_number text not null unique check(account_number ~ '^[0-9]{4,24}$'),
  label text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists mt5_accounts_client_idx on public.mt5_accounts(client_id);
create index if not exists clients_full_name_idx on public.clients(full_name);

create table if not exists public.deposit_receipts (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  mt5_account_id uuid references public.mt5_accounts(id) on delete set null,
  client_name_snapshot text not null default 'Not specified',
  account_number text not null check(account_number ~ '^[0-9]{4,24}$'),
  amount_iqd numeric(18,0) not null check(amount_iqd > 0),
  exchange_rate numeric(16,4) not null check(exchange_rate > 0),
  amount_usd numeric(18,2) generated always as (round(amount_iqd / exchange_rate, 2)) stored,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists receipts_client_idx on public.deposit_receipts(client_id);
create index if not exists receipts_created_at_idx on public.deposit_receipts(created_at desc);

-- Restrict table privileges. RLS is evaluated in addition to GRANT rules.
alter table public.staff_users enable row level security;
alter table public.clients enable row level security;
alter table public.mt5_accounts enable row level security;
alter table public.deposit_receipts enable row level security;

revoke all on table public.staff_users, public.clients, public.mt5_accounts, public.deposit_receipts from anon, authenticated;
grant select on table public.staff_users to authenticated;
grant select, insert, update on table public.clients to authenticated;
grant select, insert, update, delete on table public.mt5_accounts to authenticated;
grant select, insert on table public.deposit_receipts to authenticated;

-- Runs outside the exposed public schema and returns only whether the caller
-- belongs to the preapproved staff_users allowlist.
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_users s
    where s.user_id = (select auth.uid())
      and s.role in ('admin','operator')
  );
$$;

revoke all on function private.is_staff() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_staff() to authenticated;

-- Staff members may see only their own authorization record.
drop policy if exists staff_read_self on public.staff_users;
create policy staff_read_self on public.staff_users
for select to authenticated
using (user_id = (select auth.uid()));

-- All private client rows require staff allowlist membership.
drop policy if exists clients_staff_read on public.clients;
create policy clients_staff_read on public.clients
for select to authenticated
using ((select private.is_staff()));

drop policy if exists clients_staff_add on public.clients;
create policy clients_staff_add on public.clients
for insert to authenticated
with check ((select private.is_staff()));

drop policy if exists clients_staff_edit on public.clients;
create policy clients_staff_edit on public.clients
for update to authenticated
using ((select private.is_staff()))
with check ((select private.is_staff()));

-- MT5 accounts have unique numbers but a client may have many rows.
drop policy if exists mt5_staff_read on public.mt5_accounts;
create policy mt5_staff_read on public.mt5_accounts
for select to authenticated
using ((select private.is_staff()));

drop policy if exists mt5_staff_add on public.mt5_accounts;
create policy mt5_staff_add on public.mt5_accounts
for insert to authenticated
with check ((select private.is_staff()));

drop policy if exists mt5_staff_edit on public.mt5_accounts;
create policy mt5_staff_edit on public.mt5_accounts
for update to authenticated
using ((select private.is_staff()))
with check ((select private.is_staff()));

drop policy if exists mt5_staff_delete on public.mt5_accounts;
create policy mt5_staff_delete on public.mt5_accounts
for delete to authenticated
using ((select private.is_staff()));

-- Deposit records can only be inserted or read, not silently rewritten/deleted.
drop policy if exists receipts_staff_read on public.deposit_receipts;
create policy receipts_staff_read on public.deposit_receipts
for select to authenticated
using ((select private.is_staff()));

drop policy if exists receipts_staff_add on public.deposit_receipts;
create policy receipts_staff_add on public.deposit_receipts
for insert to authenticated
with check ((select private.is_staff()) and created_by = (select auth.uid()));

-- SECURITY SETUP (run separately AFTER creating your staff auth user):
-- 1. Supabase Dashboard > Authentication > Users > Add user.
-- 2. Copy the User UID of that authorized person.
-- 3. Replace the example UUID below and run the INSERT in SQL Editor.
-- insert into public.staff_users(user_id, role)
-- values ('REPLACE-WITH-ACTUAL-AUTH-USER-UUID', 'admin');
--
-- Keep Authentication > Providers > Email enabled, but turn public signups OFF.
-- Consider MFA, particularly when accessing customer records from mobile devices.

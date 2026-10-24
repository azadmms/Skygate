-- SkyGate Operations v2. Designed for NEW Supabase projects and for migration
-- from the earlier SkyGate Desk schema. Back up existing data before running.
-- Run in Supabase SQL Editor under an administrator's database session.
-- RLS/column-grants protect PII and prevent browser SQL from reading secrets.
-- Portal passwords are encrypted IN THE BROWSER and only ciphertext is stored.

begin;
create schema if not exists private;

create table if not exists public.staff_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('admin','operator')),
  created_at timestamptz not null default now()
);

create table if not exists public.ibs (
  id uuid primary key default gen_random_uuid(),
  ib_code text not null check (length(btrim(ib_code)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 120),
  email text,
  phone text,
  trading_account_number text,
  portal_secret jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients add column if not exists ib_id uuid references public.ibs(id) on delete set null;
alter table public.clients add column if not exists portal_secret jsonb;

create table if not exists public.mt5_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_number text not null unique check (account_number ~ '^[0-9]{4,24}$'),
  label text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.exchange_rates (
  id integer primary key default 1 check(id=1),
  iqd_per_usd numeric(16,4) not null check(iqd_per_usd > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.exchange_rates(id, iqd_per_usd)
values (1, 1500)
on conflict(id) do nothing;
-- Initial 1500 is a PLACEHOLDER only; change it before real use.

create table if not exists public.deposit_receipts (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  mt5_account_id uuid references public.mt5_accounts(id) on delete set null,
  client_name_snapshot text not null default 'Not specified',
  account_number text not null check(account_number ~ '^[0-9]{4,24}$'),
  amount_iqd numeric(18,0) not null check(amount_iqd > 0),
  exchange_rate numeric(16,4) not null check(exchange_rate > 0),
  amount_usd numeric(18,2),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Earlier SkyGate schema used a generated amount_usd column. Convert it
-- to a normal column so USD-origin and IQD-origin receipts can both be stored.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid='public.deposit_receipts'::regclass
      and attname='amount_usd' and attgenerated <> ''
  ) then
    alter table public.deposit_receipts drop column amount_usd;
    alter table public.deposit_receipts add column amount_usd numeric(18,2);
  end if;
end $$;

alter table public.deposit_receipts add column if not exists ib_id uuid references public.ibs(id) on delete set null;
alter table public.deposit_receipts add column if not exists source_currency text default 'IQD';
alter table public.deposit_receipts add column if not exists source_amount numeric(18,2);
alter table public.deposit_receipts add column if not exists record_status text not null default 'recorded';
update public.deposit_receipts
set amount_usd = round(amount_iqd / exchange_rate, 2)
where amount_usd is null;
update public.deposit_receipts
set source_amount = amount_iqd
where source_amount is null;
update public.deposit_receipts
set source_currency = 'IQD'
where source_currency is null;
alter table public.deposit_receipts alter column amount_usd set not null;
alter table public.deposit_receipts alter column source_amount set not null;
alter table public.deposit_receipts alter column source_currency set not null;
alter table public.deposit_receipts
  drop constraint if exists deposit_receipts_source_currency_check;
alter table public.deposit_receipts
  add constraint deposit_receipts_source_currency_check
  check (source_currency in ('IQD','USD'));
alter table public.deposit_receipts
  drop constraint if exists deposit_receipts_amounts_positive;
alter table public.deposit_receipts
  add constraint deposit_receipts_amounts_positive
  check (amount_iqd > 0 and amount_usd > 0 and source_amount > 0);

create table if not exists public.portal_access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  subject_type text not null check(subject_type in ('client','ib')),
  subject_id uuid not null,
  accessed_at timestamptz not null default now()
);

-- Enforce uniqueness in the database, not just in JavaScript.
create unique index if not exists ibs_code_unique on public.ibs(lower(btrim(ib_code)));
create unique index if not exists ibs_email_unique on public.ibs(lower(btrim(email)))
  where nullif(btrim(email),'') is not null;
create unique index if not exists ibs_trading_number_unique on public.ibs(trading_account_number)
  where nullif(btrim(trading_account_number),'') is not null;
create unique index if not exists clients_email_unique on public.clients(lower(btrim(email)))
  where nullif(btrim(email),'') is not null;
create unique index if not exists clients_phone_unique on public.clients((regexp_replace(phone,'[^0-9]','','g')))
  where nullif(regexp_replace(phone,'[^0-9]','','g'),'') is not null;
create index if not exists clients_ib_id_idx on public.clients(ib_id);
create index if not exists clients_name_idx on public.clients(full_name);
create index if not exists mt5_accounts_client_idx on public.mt5_accounts(client_id);
create index if not exists mt5_accounts_prefix_idx on public.mt5_accounts(account_number text_pattern_ops);
create index if not exists receipts_created_idx on public.deposit_receipts(created_at desc);
create index if not exists audit_actor_time_idx on public.portal_access_audit(actor_id, accessed_at desc);

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.staff_users s
    where s.user_id = (select auth.uid())
      and s.role in ('admin','operator')
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.staff_users s
    where s.user_id = (select auth.uid()) and s.role='admin'
  );
$$;

-- Restrict all API access to allowed Supabase Auth staff users.
alter table public.staff_users enable row level security;
alter table public.ibs enable row level security;
alter table public.clients enable row level security;
alter table public.mt5_accounts enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.deposit_receipts enable row level security;
alter table public.portal_access_audit enable row level security;

revoke all on public.staff_users, public.ibs, public.clients, public.mt5_accounts,
  public.exchange_rates, public.deposit_receipts, public.portal_access_audit
from anon, authenticated;

-- Only nonsecret fields may be queried directly through PostgREST.
grant select on public.staff_users to authenticated;
grant select (id,ib_code,name,email,phone,trading_account_number,created_at,updated_at)
  on public.ibs to authenticated;
grant insert (ib_code,name,email,phone,trading_account_number,portal_secret)
  on public.ibs to authenticated;
grant update (ib_code,name,email,phone,trading_account_number,portal_secret,updated_at)
  on public.ibs to authenticated;
grant select (id,ib_id,full_name,email,phone,created_at,updated_at)
  on public.clients to authenticated;
grant insert (ib_id,full_name,email,phone,portal_secret)
  on public.clients to authenticated;
grant update (ib_id,full_name,email,phone,portal_secret,updated_at)
  on public.clients to authenticated;
grant select, insert, update, delete on public.mt5_accounts to authenticated;
grant select, insert, update on public.exchange_rates to authenticated;
grant select, insert on public.deposit_receipts to authenticated;
grant select on public.portal_access_audit to authenticated;
-- No direct insert/read of portal_secret for viewers via SELECT grants.

revoke all on function private.is_staff() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_staff(), private.is_admin() to authenticated;

-- Old policies are redefined safely on a migration.
drop policy if exists staff_read_self on public.staff_users;
create policy staff_read_self on public.staff_users
  for select to authenticated using (user_id=(select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['ibs','clients','mt5_accounts','exchange_rates','deposit_receipts','portal_access_audit']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_staff_read',t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_staff()))',t||'_staff_read',t);
  end loop;
end $$;

-- Supersede v1 policies, which are still present after migration.
drop policy if exists clients_staff_add on public.clients;
drop policy if exists clients_staff_edit on public.clients;
drop policy if exists mt5_staff_add on public.mt5_accounts;
drop policy if exists mt5_staff_edit on public.mt5_accounts;
drop policy if exists mt5_staff_delete on public.mt5_accounts;
drop policy if exists receipts_staff_add on public.deposit_receipts;

create policy ibs_staff_add on public.ibs for insert to authenticated
  with check ((select private.is_staff()));
create policy ibs_staff_edit on public.ibs for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy clients_staff_add on public.clients for insert to authenticated
  with check ((select private.is_staff()));
create policy clients_staff_edit on public.clients for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy mt5_staff_add on public.mt5_accounts for insert to authenticated
  with check ((select private.is_staff()));
create policy mt5_staff_edit on public.mt5_accounts for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy mt5_staff_delete on public.mt5_accounts for delete to authenticated
  using ((select private.is_staff()));
create policy exchange_rates_staff_add on public.exchange_rates for insert to authenticated
  with check ((select private.is_staff()) and updated_by=(select auth.uid()));
create policy exchange_rates_staff_edit on public.exchange_rates for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()) and updated_by=(select auth.uid()));
create policy receipts_staff_add on public.deposit_receipts for insert to authenticated
  with check ((select private.is_staff()) and created_by=(select auth.uid()));

create policy audit_admin_read on public.portal_access_audit
  as restrictive for select to authenticated using ((select private.is_admin()));

-- MFA-gated and audited retrieval of ciphertext ONLY, never plaintext.
create or replace function public.reveal_portal_secret(p_kind text, p_record_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare result jsonb;
begin
  if not private.is_staff() then
    raise exception 'Unauthorized staff access' using errcode='42501';
  end if;
  if coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'MFA verification required to reveal portal credentials' using errcode='42501';
  end if;
  if p_kind='client' then
    select portal_secret into result from public.clients where id=p_record_id;
  elsif p_kind='ib' then
    select portal_secret into result from public.ibs where id=p_record_id;
  else
    raise exception 'Unknown credential type';
  end if;
  if result is null then
    raise exception 'No stored portal credential for this record';
  end if;
  insert into public.portal_access_audit (actor_id,subject_type,subject_id)
  values (auth.uid(),p_kind,p_record_id);
  return result;
end;
$$;
revoke all on function public.reveal_portal_secret(text,uuid) from public, anon;
grant execute on function public.reveal_portal_secret(text,uuid) to authenticated;

-- Client and their initial MT5 accounts must commit atomically.
create or replace function public.register_client(
  p_full_name text,
  p_email text,
  p_phone text,
  p_ib_id uuid,
  p_mt5_numbers text[],
  p_portal_secret jsonb default null
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare new_id uuid; num text;
begin
  if not private.is_staff() then
    raise exception 'Unauthorized staff access' using errcode='42501';
  end if;
  if nullif(btrim(p_full_name),'') is null then
    raise exception 'Client full name is required';
  end if;
  if coalesce(array_length(p_mt5_numbers,1),0)=0 then
    raise exception 'At least one MT5 account is required';
  end if;
  insert into public.clients(full_name,email,phone,ib_id,portal_secret)
  values (btrim(p_full_name), nullif(lower(btrim(p_email)),''),
          nullif(btrim(p_phone),''),p_ib_id,p_portal_secret)
  returning id into new_id;
  foreach num in array p_mt5_numbers loop
    if num !~ '^[0-9]{4,24}$' then
      raise exception 'MT5 account must be 4-24 digits';
    end if;
    insert into public.mt5_accounts(client_id,account_number)
    values (new_id,num);
  end loop;
  return new_id;
end;
$$;
revoke all on function public.register_client(text,text,text,uuid,text[],jsonb) from public, anon;
grant execute on function public.register_client(text,text,text,uuid,text[],jsonb) to authenticated;

-- Force applicants to explicitly enroll and complete MFA for revealing credentials.
-- Other staff operations remain available with ordinary authentication.
commit;

-- STAFF SETUP: create staff account first (Authentication -> Users), then run:
-- insert into public.staff_users (user_id,role)
-- values ('PASTE-REAL-AUTH-USER-UUID-HERE','admin');
-- Disable public signups. Never add a service_role key to any GitHub file.
-- If migrating earlier version, take a database backup and inspect duplicates
-- before running: unique indexes will reject duplicate email/phone/account values.

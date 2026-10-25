-- SkyGate Operations v4. Designed for NEW Supabase projects only. Use upgrade_v2_to_v3.sql for migration
-- from the earlier SkyGate Desk schema. Back up existing data before running.
-- Run in Supabase SQL Editor under an administrator's database session.
-- RLS/column-grants protect PII and prevent browser SQL from reading secrets.
-- No client/IB password fields, receipt table, or receipt history exist in this schema.

begin;
create schema if not exists private;

create table if not exists public.staff_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('admin','operator')),
  created_at timestamptz not null default now()
);

create table if not exists public.ibs (
  id uuid primary key default gen_random_uuid(),
  ib_code text check (ib_code is null or length(btrim(ib_code)) between 1 and 40),
  name text check (name is null or length(btrim(name)) between 1 and 120),
  email text,
  phone text,
  trading_account_number text,
  notes text check (notes is null or char_length(notes)<=3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text check (full_name is null or length(btrim(full_name)) between 1 and 120),
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients add column if not exists ib_id uuid references public.ibs(id) on delete set null;
alter table public.clients add column if not exists notes text;
alter table public.clients add constraint clients_notes_length check (notes is null or char_length(notes)<=3000);

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

revoke all on public.staff_users, public.ibs, public.clients, public.mt5_accounts,
  public.exchange_rates
from anon, authenticated;

-- Only approved staff can access client and IB records through PostgREST.
grant select on public.staff_users to authenticated;
grant select (id,ib_code,name,email,phone,trading_account_number,notes,created_at,updated_at)
  on public.ibs to authenticated;
grant insert (ib_code,name,email,phone,trading_account_number,notes)
  on public.ibs to authenticated;
grant update (ib_code,name,email,phone,trading_account_number,notes,updated_at)
  on public.ibs to authenticated;
grant select (id,ib_id,full_name,email,phone,notes,created_at,updated_at)
  on public.clients to authenticated;
grant insert (ib_id,full_name,email,phone,notes)
  on public.clients to authenticated;
grant update (ib_id,full_name,email,phone,notes,updated_at)
  on public.clients to authenticated;
grant select, insert, update, delete on public.mt5_accounts to authenticated;
grant select, insert, update on public.exchange_rates to authenticated;

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
  foreach t in array array['ibs','clients','mt5_accounts','exchange_rates']
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


-- Add a client with zero or more MT5 accounts in one transaction.
-- Every profile field is optional, except its automatically generated ID.
create or replace function public.register_client(
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_ib_id uuid default null,
  p_mt5_numbers text[] default '{}'::text[],
  p_notes text default null
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare new_id uuid; num text;
begin
  if not private.is_staff() then
    raise exception 'Unauthorized staff access' using errcode='42501';
  end if;
  if p_notes is not null and char_length(p_notes)>3000 then
    raise exception 'Notes must be 3000 characters or fewer';
  end if;
  insert into public.clients(full_name,email,phone,ib_id,notes)
    values (nullif(btrim(p_full_name),''), nullif(lower(btrim(p_email)),''),
      nullif(btrim(p_phone),''),p_ib_id,nullif(btrim(p_notes),''))
    returning id into new_id;
  foreach num in array coalesce(p_mt5_numbers,'{}'::text[]) loop
    if nullif(btrim(num),'') is null then continue; end if;
    if num !~ '^[0-9]{4,24}$' then
      raise exception 'MT5 account must contain 4-24 digits';
    end if;
    insert into public.mt5_accounts(client_id,account_number)
      values(new_id,num);
  end loop;
  return new_id;
end;
$$;
revoke all on function public.register_client(text,text,text,uuid,text[],text) from public, anon;
grant execute on function public.register_client(text,text,text,uuid,text[],text) to authenticated;

commit;

-- STAFF SETUP: after creating a Supabase Auth user, run:
-- insert into public.staff_users (user_id, role)
-- values ('ACTUAL-USER-UUID', 'admin');
-- Disable public signups. Never add a service_role key to GitHub.

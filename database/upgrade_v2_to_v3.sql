-- SkyGate Operations v3: upgrade an existing v2 Supabase database.
-- BACK UP BEFORE RUNNING. This intentionally PERMANENTLY DELETES old
-- client and IB portal_secret data and old portal-access audit history.
-- It does not delete client, IB, MT5, receipt or exchange-rate records.
begin;

alter table public.clients add column if not exists notes text;
alter table public.ibs add column if not exists notes text;

alter table public.clients alter column full_name drop not null;
alter table public.ibs alter column name drop not null;
alter table public.ibs alter column ib_code drop not null;

-- Postgres CHECK constraints based on optional fields accept NULL.
-- If a future schema introduced stricter NOT NULL checks, review those first.

-- Remove the credential-storage feature completely.
drop function if exists public.reveal_portal_secret(text,uuid);
drop function if exists public.register_client(text,text,text,uuid,text[],jsonb);
alter table public.clients drop column if exists portal_secret;
alter table public.ibs drop column if exists portal_secret;
drop table if exists public.portal_access_audit;

-- Notes are staff-readable, searchable, and editable. Existing staff RLS remains.
alter table public.clients drop constraint if exists clients_notes_length;
alter table public.ibs drop constraint if exists ibs_notes_length;
alter table public.clients add constraint clients_notes_length check (notes is null or char_length(notes)<=3000);
alter table public.ibs add constraint ibs_notes_length check (notes is null or char_length(notes)<=3000);

grant select (notes) on public.clients to authenticated;
grant insert (notes) on public.clients to authenticated;
grant update (notes) on public.clients to authenticated;
grant select (notes) on public.ibs to authenticated;
grant insert (notes) on public.ibs to authenticated;
grant update (notes) on public.ibs to authenticated;

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

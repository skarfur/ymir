-- Phase 2 (Domain 5, part 2): saveMember_/deleteMember_/importMembers_/
-- deactivateMembers_ from members.gs.
--
-- Two real schema mismatches surfaced while porting these (both fixed here,
-- not pre-existing Supabase-side bugs — this table was never written to
-- from the live app yet, only read via get-members):
--   1. members.kennitala was `not null`, but shared/guests.js's walk-in
--      guest flow legitimately saves a guest identified by name+birthYear
--      alone, with an EMPTY kennitala. Multiple such guests would collide
--      on members_kennitala_key if stored as '' (empty string is not NULL
--      to a unique index) — fixed by making the column nullable and always
--      writing NULL instead of '' for a blank kennitala.
--   2. The sheet's isMinor was a stored, client-set flag; this table
--      computes it from birth_year at read time instead (see
--      core_identity_and_reference_data.sql). save_member's guardian
--      cascade below triggers off the computed value, not a client flag —
--      strictly more trustworthy than the original's client-supplied
--      isMinor.
alter table public.members alter column kennitala drop not null;

-- members_role_check only allowed the five "real" roles — but saveMember_
-- has always used role='guest' for the member hub's walk-in flow and
-- ensureGuardianRecord_ has always used role='guardian' for guardian
-- login stubs. Both are legitimate, existing role values in the Sheets
-- version; the constraint was just never widened for them since nothing
-- wrote members rows through Supabase until now.
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('member','staff','captain','coxswain','admin','guest','guardian'));

-- Same extraction rule as extractInitials_ (code.gs): split on whitespace,
-- drop tokens that are already fully lowercase (connector words like
-- "van"/"de"/"af"), strip hyphens, take the first character of what's
-- left, uppercase.
create or replace function public.extract_initials_(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  tok text;
  result text := '';
begin
  if p_name is null or trim(p_name) = '' then return ''; end if;
  foreach tok in array regexp_split_to_array(trim(p_name), '\s+') loop
    if tok <> '' and tok <> lower(tok) then
      result := result || upper(left(replace(tok, '-', ''), 1));
    end if;
  end loop;
  return result;
end;
$$;
revoke execute on function public.extract_initials_(text) from public, anon, authenticated;

-- Ports ensureGuardianRecord_: makes sure a guardian kennitala has a
-- members row it can log in with. Returns null if the kt is blank/wrong
-- length and there's no name hint or existing guardians-table entry to
-- fall back to (mirrors the original's "no relationship to any minor"
-- bailout, adapted to this schema's normalized guardians table).
create or replace function public.ensure_guardian_record_(
  p_kt text, p_hint_name text, p_hint_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing record;
  gname text := coalesce(nullif(trim(p_hint_name), ''), '');
  gphone text := coalesce(nullif(trim(p_hint_phone), ''), '');
  fallback record;
  new_id uuid;
  temp_password text;
begin
  if p_kt is null or length(trim(p_kt)) <> 10 then return null; end if;

  select id, kennitala, name into existing from public.members where kennitala = p_kt;
  if found then
    return jsonb_build_object('kennitala', existing.kennitala, 'name', existing.name);
  end if;

  if gname = '' then
    select name, phone into fallback from public.guardians where kennitala = p_kt limit 1;
    if found then
      gname := coalesce(fallback.name, '');
      if gphone = '' then gphone := coalesce(fallback.phone, ''); end if;
    end if;
  end if;
  if gname = '' then return null; end if;

  temp_password := public.gen_temp_password_();
  insert into public.members (
    kennitala, name, role, email, phone, active, certifications, initials,
    preferences, password_hash, password_is_temp
  ) values (
    p_kt, gname, 'guardian', '', gphone, true, '[]'::jsonb,
    public.extract_initials_(gname), '{}'::jsonb,
    extensions.crypt(temp_password, extensions.gen_salt('bf', 10)), true
  ) returning id into new_id;

  return jsonb_build_object('kennitala', p_kt, 'name', gname, 'tempPassword', temp_password);
end;
$$;
revoke execute on function public.ensure_guardian_record_(text, text, text) from public, anon, authenticated;

-- Ports saveMember_. One function handles both the admin edit/create path
-- and the member-hub guest self-registration path (mirrors the original's
-- single saveMember_ doing both) — p_id null means create.
--
-- Field-overwrite semantics intentionally match the original exactly:
-- email/phone/birth_year/guardian* are always overwritten with whatever
-- was sent (blank clears them); name/role/initials/active fall back to
-- the existing row's value when not provided. There is no isMinor
-- parameter — the guardian cascade triggers off the birth_year just
-- written, computed the same way get-members computes it.
create or replace function public.save_member(
  p_id uuid default null,
  p_kennitala text default '',
  p_name text default null,
  p_role text default null,
  p_email text default '',
  p_phone text default '',
  p_birth_year int default null,
  p_guardian_name text default '',
  p_guardian_kennitala text default '',
  p_guardian_phone text default '',
  p_active boolean default null,
  p_initials text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_admin_caller boolean;
  ex record;
  new_id uuid;
  is_minor boolean;
  guardian_result jsonb;
  out_result jsonb;
  kt text := nullif(trim(p_kennitala), '');
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  is_admin_caller := public.is_admin();

  if p_id is not null then
    select * into ex from public.members where id = p_id;
    if not found then
      raise exception 'Member not found';
    end if;
    if not is_admin_caller then
      raise exception 'Admin only' using errcode = '28000';
    end if;

    update public.members set
      name = coalesce(nullif(p_name, ''), ex.name),
      role = coalesce(nullif(p_role, ''), ex.role),
      email = coalesce(p_email, ''),
      phone = coalesce(p_phone, ''),
      birth_year = p_birth_year,
      initials = coalesce(nullif(p_initials, ''), ex.initials, public.extract_initials_(coalesce(nullif(p_name, ''), ex.name))),
      active = coalesce(p_active, ex.active),
      updated_at = now()
      where id = p_id;

    is_minor := p_birth_year is not null and (extract(year from now())::int - p_birth_year) < 18;
    delete from public.guardians where member_id = p_id;
    if coalesce(p_guardian_name, '') <> '' or coalesce(p_guardian_kennitala, '') <> '' or coalesce(p_guardian_phone, '') <> '' then
      insert into public.guardians (member_id, name, kennitala, phone)
        values (p_id, coalesce(p_guardian_name, ''), nullif(coalesce(p_guardian_kennitala, ''), ''), coalesce(p_guardian_phone, ''));
    end if;

    out_result := jsonb_build_object('id', p_id, 'updated', true);
  else
    -- Non-admin callers can only self-register a guest (member hub's
    -- walk-in flow) — force role=guest so a crafted payload can't sneak
    -- an admin/staff row past this, matching saveMember_'s guard exactly.
    declare
      role_val text := case when is_admin_caller then coalesce(nullif(p_role, ''), 'member') else 'guest' end;
      temp_password text := public.gen_temp_password_();
    begin
      insert into public.members (
        kennitala, name, role, email, phone, birth_year, active,
        certifications, initials, preferences, password_hash, password_is_temp
      ) values (
        kt, p_name, role_val, coalesce(p_email, ''), coalesce(p_phone, ''), p_birth_year, true,
        '[]'::jsonb, coalesce(nullif(p_initials, ''), public.extract_initials_(p_name)), '{}'::jsonb,
        extensions.crypt(temp_password, extensions.gen_salt('bf', 10)), true
      ) returning id into new_id;

      is_minor := p_birth_year is not null and (extract(year from now())::int - p_birth_year) < 18;
      if coalesce(p_guardian_name, '') <> '' or coalesce(p_guardian_kennitala, '') <> '' or coalesce(p_guardian_phone, '') <> '' then
        insert into public.guardians (member_id, name, kennitala, phone)
          values (new_id, coalesce(p_guardian_name, ''), nullif(coalesce(p_guardian_kennitala, ''), ''), coalesce(p_guardian_phone, ''));
      end if;

      out_result := jsonb_build_object('id', new_id, 'created', true, 'tempPassword', temp_password);
    end;
  end if;

  if is_minor and coalesce(p_guardian_kennitala, '') <> '' then
    guardian_result := public.ensure_guardian_record_(p_guardian_kennitala, p_guardian_name, p_guardian_phone);
    if guardian_result is not null and guardian_result ? 'tempPassword' then
      out_result := out_result || jsonb_build_object('guardianTempPassword', guardian_result);
    end if;
  end if;

  return out_result;
end;
$$;
revoke execute on function public.save_member(uuid, text, text, text, text, text, int, text, text, text, boolean, text) from public, anon;
grant execute on function public.save_member(uuid, text, text, text, text, text, int, text, text, text, boolean, text) to authenticated;

-- Ports importMembers_: bulk upsert-by-kennitala, admin only. p_rows is a
-- jsonb array of {kennitala,name,role,email,phone,birthYear,guardianName,
-- guardianKennitala,guardianPhone,active}. Guardian auto-provisioning
-- cascade runs as a second pass over every row, same as the original
-- (so a guardian referenced by row N can itself appear as row N+1's own
-- data without ordering issues).
create or replace function public.import_members(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  ex record;
  kt text;
  birth_year_val int;
  is_minor boolean;
  created_count int := 0;
  updated_count int := 0;
  temp_passwords jsonb := '[]'::jsonb;
  temp_password text;
  new_id uuid;
  guardian_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows array required';
  end if;

  for row_data in select * from jsonb_array_elements(p_rows) loop
    kt := nullif(trim(coalesce(row_data->>'kennitala', '')), '');
    birth_year_val := nullif(row_data->>'birthYear', '')::int;

    -- kt = null makes this WHERE clause evaluate to unknown for every row,
    -- so it always comes back not-found without needing a branch — and
    -- crucially, SELECT INTO leaves ex "assigned" (all fields null, FOUND
    -- false) even on zero rows, unlike a bare `ex := null` which would
    -- leave later ex.id reads erroring as "not assigned yet".
    select * into ex from public.members where kennitala = kt;

    if ex.id is not null then
      update public.members set
        name = coalesce(nullif(row_data->>'name', ''), ex.name),
        email = coalesce(nullif(row_data->>'email', ''), ex.email, ''),
        phone = coalesce(nullif(row_data->>'phone', ''), ex.phone, ''),
        role = coalesce(nullif(row_data->>'role', ''), ex.role, 'member'),
        birth_year = coalesce(birth_year_val, ex.birth_year),
        active = coalesce((row_data->>'active')::boolean, ex.active),
        updated_at = now()
        where id = ex.id;
      updated_count := updated_count + 1;
    else
      temp_password := public.gen_temp_password_();
      insert into public.members (
        kennitala, name, role, email, phone, birth_year, active,
        certifications, initials, preferences, password_hash, password_is_temp
      ) values (
        kt, coalesce(row_data->>'name', ''), coalesce(nullif(row_data->>'role', ''), 'member'),
        coalesce(row_data->>'email', ''), coalesce(row_data->>'phone', ''), birth_year_val, true,
        '[]'::jsonb, public.extract_initials_(row_data->>'name'), '{}'::jsonb,
        extensions.crypt(temp_password, extensions.gen_salt('bf', 10)), true
      ) returning id into new_id;
      ex.id := new_id;
      temp_passwords := temp_passwords || jsonb_build_array(jsonb_build_object(
        'kennitala', kt, 'name', coalesce(row_data->>'name', ''), 'tempPassword', temp_password
      ));
      created_count := created_count + 1;
    end if;

    delete from public.guardians where member_id = ex.id;
    if coalesce(row_data->>'guardianName', '') <> '' or coalesce(row_data->>'guardianKennitala', '') <> '' or coalesce(row_data->>'guardianPhone', '') <> '' then
      insert into public.guardians (member_id, name, kennitala, phone) values (
        ex.id, coalesce(row_data->>'guardianName', ''),
        nullif(coalesce(row_data->>'guardianKennitala', ''), ''), coalesce(row_data->>'guardianPhone', '')
      );
    end if;
  end loop;

  -- Second pass: auto-provision guardian login stubs for every minor row
  -- in this batch, same as importMembers_.
  for row_data in select * from jsonb_array_elements(p_rows) loop
    birth_year_val := nullif(row_data->>'birthYear', '')::int;
    is_minor := birth_year_val is not null and (extract(year from now())::int - birth_year_val) < 18;
    if is_minor and coalesce(row_data->>'guardianKennitala', '') <> '' then
      guardian_result := public.ensure_guardian_record_(
        row_data->>'guardianKennitala', row_data->>'guardianName', row_data->>'guardianPhone'
      );
      if guardian_result is not null and guardian_result ? 'tempPassword' then
        temp_passwords := temp_passwords || jsonb_build_array(guardian_result);
      end if;
    end if;
  end loop;

  return jsonb_build_object('created', created_count, 'updated', updated_count, 'tempPasswords', temp_passwords);
end;
$$;
revoke execute on function public.import_members(jsonb) from public, anon;
grant execute on function public.import_members(jsonb) to authenticated;

-- deleteMember_/deactivateMembers_ are both plain soft-deletes (active =
-- false) — no business logic beyond that, so they go straight through
-- PostgREST + admin-only RLS rather than another RPC. The id-filtered
-- UPDATE needs its own SELECT policy for row visibility, same lesson as
-- the payroll migration.
create policy members_admin_select on public.members
  for select to authenticated
  using (public.is_admin());

create policy members_admin_update on public.members
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, update on public.members to authenticated;

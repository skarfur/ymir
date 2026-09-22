-- Google sign-in support + a security pass over the login/password system,
-- prompted by porting Google auth to Edge Functions (see login-with-google,
-- link-google-account, unlink-google-account). Five independent fixes:
--
-- 1. members.password_hash/password_is_temp were column-level readable AND
--    writable by any `authenticated` caller (an admin's own accessToken),
--    completely bypassing the bcrypt hashing + validation the password
--    RPCs exist for. This came from a blanket
--    `grant select, update on public.members to authenticated` added for
--    admin/members.js's direct-PostgREST deactivate-member PATCH (which
--    only ever touches `active`) — the grant was never meant to cover the
--    password columns. Narrowed to those two columns specifically; every
--    other column keeps working exactly as before.
-- 2. A unique partial index on google_email closes the TOCTOU race in
--    link-google-account's check-then-update (two concurrent links could
--    otherwise both pass the "not linked to someone else" check).
-- 3. bcrypt cost bumped 10 -> 12 on every password-hashing call site.
--    Existing hashes keep their own embedded cost and still verify fine —
--    crypt() reads the cost from the stored hash, so this only affects
--    passwords set from here on.
-- 4. change_member_password's minimum length raised from 4 to 8 — 4 was
--    far below any modern baseline (NIST SP 800-63B recommends >= 8).
--    Existing shorter passwords keep working until next changed.
-- 5. set_member_password was dead code (grepped: nothing calls it — every
--    real password-set path hashes inline in member_crud.sql). Dropping a
--    service_role-only password setter that nothing exercises is safer
--    than leaving it around for someone to accidentally wire up later
--    without the length/rate-limit checks the live paths have.
-- Plus: audit_row_change() captured the full row (including password_hash)
-- into audit_log on every members insert/update/delete. audit_log is
-- already locked down (revoked from anon/authenticated), but there's no
-- reason to keep redundant copies of bcrypt hashes around — redacted for
-- the members table specifically, every other audited table unchanged.

-- ── 1. Column-level privilege fix ────────────────────────────────────────
revoke select (password_hash, password_is_temp), update (password_hash, password_is_temp)
  on public.members from authenticated;

-- ── 2. google_email uniqueness ───────────────────────────────────────────
create unique index if not exists members_google_email_unique
  on public.members (google_email)
  where google_email <> '';

-- ── 3 & 4. Re-hash-cost + password-length bump ───────────────────────────
create or replace function public.ensure_guardian_record_(p_kt text, p_hint_name text, p_hint_phone text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    extensions.crypt(temp_password, extensions.gen_salt('bf', 12)), true
  ) returning id into new_id;

  return jsonb_build_object('kennitala', p_kt, 'name', gname, 'tempPassword', temp_password);
end;
$function$;

create or replace function public.import_members(p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
        extensions.crypt(temp_password, extensions.gen_salt('bf', 12)), true
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
$function$;

create or replace function public.save_member(p_id uuid default null::uuid, p_kennitala text default ''::text, p_name text default null::text, p_role text default null::text, p_email text default ''::text, p_phone text default ''::text, p_birth_year integer default null::integer, p_guardian_name text default ''::text, p_guardian_kennitala text default ''::text, p_guardian_phone text default ''::text, p_active boolean default null::boolean, p_initials text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
        extensions.crypt(temp_password, extensions.gen_salt('bf', 12)), true
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
$function$;

create or replace function public.change_member_password(
  p_kennitala text,
  p_current_password text default '',
  p_new_password text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_kt text;
  is_admin_acting boolean;
  target_active boolean;
  target_hash text;
  keep_session uuid;
  revoked int;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_kennitala is null or length(trim(p_kennitala)) = 0 then
    raise exception 'kennitala required';
  end if;
  if length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  caller_kt := public.current_kennitala();
  is_admin_acting := public.is_admin() and caller_kt is distinct from p_kennitala;

  select active, password_hash into target_active, target_hash
    from public.members where kennitala = p_kennitala;
  if not found then
    raise exception 'Member not found';
  end if;
  if not target_active then
    raise exception 'Inactive account' using errcode = '28000';
  end if;

  if not is_admin_acting then
    if caller_kt is distinct from p_kennitala then
      raise exception 'Forbidden' using errcode = '28000';
    end if;
    if target_hash is null or target_hash <> extensions.crypt(p_current_password, target_hash) then
      raise exception 'Current password incorrect' using errcode = '28000';
    end if;
  end if;

  update public.members
    set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
        password_is_temp = false,
        updated_at = now()
    where kennitala = p_kennitala;

  delete from public.login_attempts where kennitala = p_kennitala;

  keep_session := case when caller_kt = p_kennitala then (auth.jwt()->>'session_id')::uuid else null end;
  with del as (
    delete from public.sessions s
      using public.members m
      where m.kennitala = p_kennitala and s.member_id = m.id
        and (keep_session is null or s.id <> keep_session)
      returning s.id
  )
  select count(*) into revoked from del;

  return jsonb_build_object('saved', true, 'sessionsRevoked', revoked);
end;
$$;

create or replace function public.admin_reset_member_password(p_kennitala text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  temp_password text;
  revoked int;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_kennitala is null or length(trim(p_kennitala)) = 0 then
    raise exception 'kennitala required';
  end if;
  if not exists (select 1 from public.members where kennitala = p_kennitala) then
    raise exception 'Member not found';
  end if;

  temp_password := public.gen_temp_password_();
  update public.members
    set password_hash = extensions.crypt(temp_password, extensions.gen_salt('bf', 12)),
        password_is_temp = true,
        updated_at = now()
    where kennitala = p_kennitala;

  delete from public.login_attempts where kennitala = p_kennitala;

  with del as (
    delete from public.sessions s
      using public.members m
      where m.kennitala = p_kennitala and s.member_id = m.id
      returning s.id
  )
  select count(*) into revoked from del;

  return jsonb_build_object('reset', true, 'sessionsRevoked', revoked, 'tempPassword', temp_password);
end;
$$;

-- ── 5. Dead code removal ─────────────────────────────────────────────────
drop function if exists public.set_member_password(text, text, boolean);

-- ── audit_row_change: redact password_hash for the members table ────────
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into audit_log(table_name, row_id, action, diff)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    case tg_op
      when 'INSERT' then
        case when tg_table_name = 'members' then to_jsonb(new) - 'password_hash' else to_jsonb(new) end
      when 'UPDATE' then
        case when tg_table_name = 'members'
          then jsonb_build_object('old', to_jsonb(old) - 'password_hash', 'new', to_jsonb(new) - 'password_hash')
          else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
        end
      when 'DELETE' then
        case when tg_table_name = 'members' then to_jsonb(old) - 'password_hash' else to_jsonb(old) end
    end
  );
  return coalesce(new, old);
end;
$$;

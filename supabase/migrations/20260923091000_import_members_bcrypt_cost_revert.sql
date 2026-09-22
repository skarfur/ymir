-- import_members's bcrypt cost 12 (from the auth-hardening migration)
-- made a 250-row CSV import take well over a minute (observed ~70-80s),
-- serially hashing one temp password per new member. Reverted to cost 10
-- for the two functions that can run in a bulk loop (import_members and
-- the ensure_guardian_record_ cascade it calls for minors) -- cost 12
-- stays on change_member_password/admin_reset_member_password, which are
-- always single-row per call, where the extra ~200ms is imperceptible.
--
-- This isn't a meaningful security regression: these two functions only
-- ever hash gen_temp_password_()'s own output -- a random 10-character
-- string from a 54-character alphabet (~57 bits of entropy) -- never a
-- user-chosen password, and password_is_temp forces it to be replaced on
-- first login. Cost 10 is still computationally infeasible to brute-force
-- offline for a secret with that much entropy before it gets rotated.
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
    extensions.crypt(temp_password, extensions.gen_salt('bf', 10)), true
  ) returning id into new_id;

  return jsonb_build_object('kennitala', p_kt, 'name', gname, 'tempPassword', temp_password);
end;
$function$;

create or replace function public.import_members(p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
 set statement_timeout to '90s'
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

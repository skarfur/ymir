-- Phase 2 (Domain 5, part 1): setPassword_/adminResetMemberPassword_ from
-- members.gs, as caller-scoped RPCs. verify_member_password/
-- set_member_password (auth_password_and_rate_limit.sql) stay service_role
-- -only primitives — these two new functions are the public entry points,
-- reproducing setPassword_'s self-vs-admin-acting branch and
-- adminResetMemberPassword_'s admin-only gate exactly, plus both
-- functions' session-revocation and login_attempts-clearing side effects.

-- 10-char unambiguous-alphabet temp password, same alphabet and length as
-- genTempPassword_ (code.gs) — no O/0/I/1/l.
create or replace function public.gen_temp_password_()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  bytes  bytea := extensions.gen_random_bytes(10);
  result text := '';
  i      int;
begin
  for i in 0..9 loop
    result := result || substr(chars, (get_byte(bytes, i) % length(chars)) + 1, 1);
  end loop;
  return result;
end;
$$;
revoke execute on function public.gen_temp_password_() from public, anon, authenticated;

-- Self-service change (or admin acting on someone else's record, which
-- skips the current-password check — mirrors setPassword_'s
-- isAdminActing branch exactly).
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
  if length(p_new_password) < 4 then
    raise exception 'Password must be at least 4 characters';
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
    set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
        password_is_temp = false,
        updated_at = now()
    where kennitala = p_kennitala;

  delete from public.login_attempts where kennitala = p_kennitala;

  -- Preserve the caller's own session when changing their own password;
  -- an admin resetting someone else's password has no session of the
  -- target's to preserve.
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
revoke execute on function public.change_member_password(text, text, text) from public, anon;
grant execute on function public.change_member_password(text, text, text) to authenticated;

-- Admin-only: issue a fresh temp password, revoke every session for the
-- member (unlike change_member_password, there is no "caller's own
-- session" to preserve here — admin and target are different people).
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
    set password_hash = extensions.crypt(temp_password, extensions.gen_salt('bf', 10)),
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
revoke execute on function public.admin_reset_member_password(text) from public, anon;
grant execute on function public.admin_reset_member_password(text) to authenticated;

-- Ports members.gs's signOut_/signOutAll_ as Postgres RPC functions,
-- callable via supabase.rpc('sign_out', {...}) using the caller's JWT —
-- no Edge Function needed. Ownership is checked against
-- current_member_id() (from the JWT claims) rather than kennitala,
-- matching how the sessions table is actually keyed here (member_id FK,
-- no kennitala column).

-- Revoke the caller's current session, or a specific session by id —
-- still restricted to the caller's own member_id so one caller can't
-- revoke another's session by guessing an id. Idempotent: deleting zero
-- rows (already-gone session) still returns signedOut: true, matching
-- the original's "always returns 200" behavior.
create or replace function public.sign_out(p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  target := coalesce(p_session_id, (auth.jwt()->>'session_id')::uuid);
  delete from public.sessions
    where id = target and member_id = public.current_member_id();
  return jsonb_build_object('signedOut', true);
end;
$$;

-- Revoke every session belonging to the caller. p_except_current keeps
-- the calling session alive (settings page's "sign out everywhere else"),
-- matching signOutAll_'s exceptCurrent flag.
create or replace function public.sign_out_all(p_except_current boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep uuid;
  n int;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  keep := case when p_except_current then (auth.jwt()->>'session_id')::uuid else null end;
  delete from public.sessions
    where member_id = public.current_member_id()
      and (keep is null or id <> keep);
  get diagnostics n = row_count;
  return jsonb_build_object('signedOut', true, 'count', n);
end;
$$;

grant execute on function public.sign_out(uuid) to authenticated;
grant execute on function public.sign_out_all(boolean) to authenticated;

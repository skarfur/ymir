-- RLS authorization helpers, part of the move from one-Edge-Function-per-
-- action to PostgREST + RLS + RPC (see /root/.claude/plans/glistening-
-- soaring-fairy.md for the full design). Ymir doesn't use Supabase Auth
-- (auth.users) — login/session logic (PBKDF2 passwords, bootstrap
-- kennitala flow, Google linking) stays entirely custom, backed by the
-- existing members/sessions tables. login/refresh-session additionally
-- mint a self-signed JWT carrying custom claims (app_role, member_id,
-- kennitala, session_id) that auth.jwt() exposes to Postgres — these
-- helpers read those claims and are the single source of truth every RLS
-- policy should build on, mirroring code.gs's isAdmin_/isStaff_/
-- ADMIN_ACTIONS_/STAFF_ACTIONS_ distinctions.

-- session_valid() is the actual revocation/expiry authority: a JWT's own
-- `exp` only bounds worst-case replay of a stolen token, but deleting the
-- session row (sign-out, sign-out-everywhere, expiry sweep) makes any
-- still-unexpired JWT instantly rejected by every policy that calls this.
create or replace function public.session_valid() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions
    where id = (auth.jwt()->>'session_id')::uuid
      and expires_at > now()
  );
$$;

create or replace function public.current_member_id() returns uuid
language sql stable as $$
  select (auth.jwt()->>'member_id')::uuid;
$$;

create or replace function public.current_kennitala() returns text
language sql stable as $$
  select auth.jwt()->>'kennitala';
$$;

create or replace function public.current_app_role() returns text
language sql stable as $$
  select auth.jwt()->>'app_role';
$$;

-- Staff-or-admin: mirrors code.gs's isStaff_ (STAFF_ACTIONS_ gate).
create or replace function public.is_staff_or_admin() returns boolean
language sql stable as $$
  select public.session_valid() and public.current_app_role() in ('staff', 'admin');
$$;

-- Admin-only: mirrors code.gs's isAdmin_ (ADMIN_ACTIONS_ gate).
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select public.session_valid() and public.current_app_role() = 'admin';
$$;

grant execute on function public.session_valid() to authenticated;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.current_kennitala() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_staff_or_admin() to authenticated;
grant execute on function public.is_admin() to authenticated;

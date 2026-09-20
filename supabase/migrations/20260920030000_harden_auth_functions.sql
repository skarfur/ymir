-- Advisor-flagged hardening on the Phase 0 auth functions:
--
-- 1. Pin search_path on every helper (not just the security definer one) —
--    an unpinned search_path on a SECURITY DEFINER *or* a plain function
--    called from RLS policies is a hijack vector if a malicious schema
--    ever shadows public.session_valid()/auth.jwt().
-- 2. Postgres grants EXECUTE to PUBLIC by default on function creation,
--    and this Supabase project's default privileges additionally grant
--    execute on every new public-schema function directly to `anon` and
--    `authenticated` (so PostgREST can serve them out of the box) — so
--    despite only ever explicitly granting to `authenticated`,
--    session_valid()/sign_out()/sign_out_all() were still callable by
--    `anon` via both paths. Revoking from both PUBLIC and anon closes
--    it — anon has no valid session_id/member_id claims anyway so this
--    was never exploitable, but explicit is better than implicit here.
alter function public.current_member_id() set search_path = '';
alter function public.current_kennitala() set search_path = '';
alter function public.current_app_role() set search_path = '';
alter function public.is_staff_or_admin() set search_path = '';
alter function public.is_admin() set search_path = '';

revoke execute on function public.session_valid() from public, anon;
revoke execute on function public.current_member_id() from public, anon;
revoke execute on function public.current_kennitala() from public, anon;
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_staff_or_admin() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.sign_out(uuid) from public, anon;
revoke execute on function public.sign_out_all(boolean) from public, anon;

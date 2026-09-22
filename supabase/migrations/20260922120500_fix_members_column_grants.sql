-- Follow-up to google_signin_and_auth_hardening: that migration's
-- column-level REVOKE on password_hash/password_is_temp had no effect,
-- because the original grant was table-level (`grant select, update on
-- public.members to authenticated`). PostgreSQL's column-level REVOKE
-- can't subtract from a table-level grant -- there's no "table-level minus
-- these columns" ACL representation, so authenticated could still read and
-- write both password columns afterward (verified via
-- information_schema.column_privileges after applying it).
--
-- Fixed properly here: revoke the table-level grant entirely, then
-- re-grant precisely what's actually used --
--   - SELECT on every column except password_hash/password_is_temp (an
--     admin's own accessToken reading their own already-admin-gated rows
--     isn't new exposure; those two columns specifically are the ones
--     that must never leave the bcrypt/RPC boundary)
--   - UPDATE on just `active` (the only column admin/members.js's
--     direct-PostgREST deactivate-member PATCH ever touches -- verified by
--     grep, no other direct-PostgREST write to members exists)
-- RLS (members_admin_select/members_admin_update, both is_admin()-gated)
-- is unchanged and still the row-visibility gate on top of this.

revoke select, update on public.members from authenticated;

grant select (
  id, kennitala, name, role, email, phone, birth_year, active,
  certifications, initials, preferences, google_email, created_at,
  updated_at, bio, headshot_url
) on public.members to authenticated;

grant update (active) on public.members to authenticated;

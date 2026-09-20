-- Phase 1: finish payroll (Domain 4) in the new architecture rather than
-- shipping two more one-action Edge Functions. saveEmployee_ and
-- adminDeleteTime_ are both in ADMIN_ACTIONS_ (code.gs) with no other
-- gating, so admin-only RLS reproduces authorize_'s check exactly.
--
-- clockIn/clockOut/breakStart/breakEnd/getTimeEntries/adminEditTime/
-- adminAddTime/getEmployees stay on their already-shipped Edge Functions
-- for now — retrofitting those is Phase 3 (domain-wide), not this task.

create policy employees_admin_insert on public.employees
  for insert to authenticated
  with check (public.is_admin());

create policy employees_admin_update on public.employees
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy time_clock_admin_delete on public.time_clock
  for delete to authenticated
  using (public.is_admin());

grant insert, update on public.employees to authenticated;
grant delete on public.time_clock to authenticated;

-- A WHERE-clause filter (id=...) needs an actual SELECT policy for row
-- visibility, separate from the UPDATE/DELETE policies' own USING clause.
-- Verified empirically against this project: without a SELECT policy, an
-- id-filtered UPDATE/DELETE matches zero rows even though is_admin() is
-- true and the UPDATE/DELETE policy's own USING clause is satisfied —
-- Postgres still needs a SELECT policy to make the row visible to the
-- WHERE-clause scan in the first place. Admin-only, matching every other
-- action on these two tables.
create policy employees_admin_select on public.employees
  for select to authenticated
  using (public.is_admin());

create policy time_clock_admin_select on public.time_clock
  for select to authenticated
  using (public.is_admin());

grant select on public.employees to authenticated;
grant select on public.time_clock to authenticated;

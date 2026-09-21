-- Phase 3 continuation: cancelClassOccurrence_/restoreClassOccurrence_ from
-- checkouts.gs, as Postgres RPCs. These are the admin Scheduling tab's
-- "cancel this one occurrence of a recurring class" / "undo that" actions —
-- still routed at the dead Apps Script path (401s harmlessly since the
-- earlier logout-bug fix, but the feature itself never worked once
-- loginMember moved to Supabase).
--
-- overrideClassOccurrence_ (one-shot time reschedule for a single
-- occurrence) is deliberately NOT ported: admin/scheduling.js's own header
-- comment says the frontend never surfaces it ("there is no per-occurrence
-- editor for non-volunteer activities... if a picker is needed, it's a
-- separate feature") — zero live callers, same as silenceAlert/snoozeAlert
-- earlier in this migration.
--
-- Google Calendar sync (_patchGcalInstanceStatus_ on both sides) is
-- deliberately NOT ported either — same deferral already established for
-- every other Calendar-touching write this migration (activity types,
-- volunteer events: "Google Calendar sync ... is deliberately not
-- ported, same deferral as every other Calendar-touching write").
--
-- The original wrote a local tombstone row keyed by a deterministic id
-- (`sched-{classId}-{date}`) so re-cancelling/restoring the same occurrence
-- upserts rather than duplicating. activities.id is a real uuid PK here
-- (no deterministic-id shape available), so the equivalent upsert key is
-- (source_activity_type_id, date, signup_required = false) instead — the
-- combination that's unique per plain (non-volunteer) class occurrence.
create or replace function public.cancel_class_occurrence(p_class_id text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  class_uuid uuid;
  existing_id uuid;
  tmpl jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_class_id is null or p_class_id = '' or p_date is null then
    raise exception 'classId and date required';
  end if;
  begin
    class_uuid := p_class_id::uuid;
  exception when invalid_text_representation then
    raise exception 'classId and date required';
  end;

  select elem into tmpl
    from jsonb_array_elements(coalesce(
      (select value from public.app_config where key = 'activity_templates'), '[]'::jsonb
    )) as elem
    where elem->>'id' = p_class_id
    limit 1;

  select id into existing_id from public.activities
    where source_activity_type_id = class_uuid and date = p_date and signup_required = false
    limit 1;

  if existing_id is not null then
    update public.activities set
      status = 'cancelled',
      activity_type_id = class_uuid,
      title = coalesce(tmpl->>'name', title),
      title_is = coalesce(tmpl->>'nameIS', title_is),
      updated_at = now()
    where id = existing_id;
  else
    insert into public.activities (
      signup_required, status, source_activity_type_id, activity_type_id,
      date, title, title_is, actor_id
    ) values (
      false, 'cancelled', class_uuid, class_uuid,
      p_date, coalesce(tmpl->>'name', ''), coalesce(tmpl->>'nameIS', ''),
      public.current_member_id()
    );
  end if;

  return jsonb_build_object('cancelled', true);
end;
$$;
revoke execute on function public.cancel_class_occurrence(text, date) from public, anon;
grant execute on function public.cancel_class_occurrence(text, date) to authenticated;

-- Undo a previous cancellation: drop the tombstone row so the client-side
-- projection (buildUpcomingEvents in shared/scheduled-event.js) re-emits
-- the virtual occurrence again. Only removes a row that's actually a
-- cancelled tombstone — matches the original's guard against blowing away
-- an override row that happened to share the same deterministic id (not a
-- concern here since override isn't ported, but keeping the guard is free
-- and correct).
create or replace function public.restore_class_occurrence(p_class_id text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  class_uuid uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_class_id is null or p_class_id = '' or p_date is null then
    raise exception 'classId and date required';
  end if;
  begin
    class_uuid := p_class_id::uuid;
  exception when invalid_text_representation then
    raise exception 'classId and date required';
  end;

  delete from public.activities
    where source_activity_type_id = class_uuid
      and date = p_date
      and signup_required = false
      and status = 'cancelled';

  return jsonb_build_object('restored', true);
end;
$$;
revoke execute on function public.restore_class_occurrence(text, date) from public, anon;
grant execute on function public.restore_class_occurrence(text, date) to authenticated;

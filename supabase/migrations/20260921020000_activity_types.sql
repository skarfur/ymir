-- Phase 2 (Domain 5, part 4): saveActivityType_/deleteActivityType_.
--
-- Google Calendar sync (syncClassRecurringEvent_ on save,
-- Calendar.Events.remove on delete) is deliberately NOT ported here —
-- same deferral already established for every other Calendar-touching
-- write this migration (see save-volunteer-event's and
-- delete-volunteer-event's header comments: "Google Calendar sync ...
-- is deliberately not ported, same deferral as every other
-- Calendar-touching write"). The DB-only mechanics (config-list upsert,
-- cascade-delete of linked volunteer events + signups) are ported in
-- full.
--
-- activity_templates ids are NOT reused via save_config_list_item's
-- generic id generator: public.activities.activity_type_id and
-- .source_activity_type_id are real `uuid` columns (see
-- save-volunteer-event's asUuid() coercion), so a new activity type
-- needs an actual uuid, not the legacy 16-char uid_() hex string the
-- Apps Script side used or the "key_hexstring" shape
-- save_config_list_item generates for certDefs. Bespoke upsert here
-- rather than delegating to that helper.
create or replace function public.save_activity_type(
  p_id text default null,
  p_name text default '',
  p_name_is text default '',
  p_active boolean default true,
  p_class_tag text default '',
  p_class_tag_is text default '',
  p_calendar_id text default '',
  p_calendar_sync_active boolean default false,
  p_schedule_source text default 'bulk',
  p_volunteer boolean default false,
  p_roles jsonb default '[]'::jsonb,
  p_leader_member_id text default '',
  p_leader_name text default '',
  p_leader_phone text default '',
  p_show_leader_phone boolean default false,
  p_default_start text default '',
  p_default_end text default '',
  p_bulk_schedule jsonb default null,
  p_reserved_boat_ids jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_source text := case when p_schedule_source = 'calendar' then 'calendar' else 'bulk' end;
  item_id text := nullif(trim(p_id), '');
  is_vol boolean := coalesce(p_volunteer, false);
  arr jsonb;
  item jsonb;
  found_idx int := null;
  i int;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if coalesce(trim(p_leader_member_id), '') = '' and coalesce(trim(p_leader_name), '') = '' then
    raise exception 'saveActivityType failed: leader is required';
  end if;
  if item_id is null then
    item_id := gen_random_uuid()::text;
  end if;

  item := jsonb_build_object(
    'id', item_id,
    'name', coalesce(p_name, ''), 'nameIS', coalesce(p_name_is, ''),
    'active', coalesce(p_active, true),
    'classTag', coalesce(p_class_tag, ''), 'classTagIS', coalesce(p_class_tag_is, ''),
    'calendarId', coalesce(p_calendar_id, ''), 'calendarSyncActive', coalesce(p_calendar_sync_active, false),
    'scheduleSource', schedule_source,
    'volunteer', is_vol,
    'roles', case when is_vol then coalesce(p_roles, '[]'::jsonb) else '[]'::jsonb end,
    'leaderMemberId', coalesce(p_leader_member_id, ''), 'leaderName', coalesce(p_leader_name, ''),
    'leaderPhone', coalesce(p_leader_phone, ''), 'showLeaderPhone', coalesce(p_show_leader_phone, false),
    'defaultStart', coalesce(p_default_start, ''), 'defaultEnd', coalesce(p_default_end, ''),
    'bulkSchedule', p_bulk_schedule,
    'reservedBoatIds', coalesce(p_reserved_boat_ids, '[]'::jsonb)
  );

  select coalesce(value, '[]'::jsonb) into arr from public.app_config where key = 'activity_templates';
  if arr is null then arr := '[]'::jsonb; end if;

  for i in 0 .. jsonb_array_length(arr) - 1 loop
    if arr->i->>'id' = item_id then found_idx := i; end if;
  end loop;

  if found_idx is not null then
    arr := jsonb_set(arr, array[found_idx::text], item);
  else
    arr := arr || jsonb_build_array(item);
  end if;

  insert into public.app_config (key, value, updated_at) values ('activity_templates', arr, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('id', item_id, 'item', item);
end;
$$;
revoke execute on function public.save_activity_type(
  text, text, text, boolean, text, text, text, boolean, text, boolean, jsonb, text, text, text, boolean, text, text, jsonb, jsonb
) from public, anon;
grant execute on function public.save_activity_type(
  text, text, text, boolean, text, text, text, boolean, text, boolean, jsonb, text, text, text, boolean, text, text, jsonb, jsonb
) to authenticated;

-- Hard-deletes the activity_templates entry, then cascades to every
-- linked volunteer event (activities rows with signup_required=true
-- whose source_activity_type_id or activity_type_id matches) and their
-- signups — same cascade deleteActivityType_ runs, minus the GCal
-- teardown. Always returns deleted:true unconditionally, matching the
-- original (it never checked whether the id actually existed either).
create or replace function public.delete_activity_type(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  arr jsonb;
  new_arr jsonb := '[]'::jsonb;
  elem jsonb;
  ev_ids uuid[];
  removed_events int := 0;
  removed_signups int := 0;
  type_uuid uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_id is null or p_id = '' then
    raise exception 'id required';
  end if;

  select value into arr from public.app_config where key = 'activity_templates';
  if arr is not null then
    for elem in select * from jsonb_array_elements(arr) loop
      if elem->>'id' <> p_id then new_arr := new_arr || jsonb_build_array(elem); end if;
    end loop;
    update public.app_config set value = new_arr, updated_at = now() where key = 'activity_templates';
  end if;

  begin
    type_uuid := p_id::uuid;
  exception when invalid_text_representation then
    type_uuid := null;
  end;

  if type_uuid is not null then
    select array_agg(id) into ev_ids from public.activities
      where signup_required = true
        and (source_activity_type_id = type_uuid or activity_type_id = type_uuid);

    if ev_ids is not null and array_length(ev_ids, 1) > 0 then
      delete from public.volunteer_signups where event_id = any(ev_ids);
      get diagnostics removed_signups = row_count;
      delete from public.activities where id = any(ev_ids);
      get diagnostics removed_events = row_count;
    end if;
  end if;

  return jsonb_build_object('deleted', true, 'removedEvents', removed_events, 'removedSignups', removed_signups);
end;
$$;
revoke execute on function public.delete_activity_type(text) from public, anon;
grant execute on function public.delete_activity_type(text) to authenticated;

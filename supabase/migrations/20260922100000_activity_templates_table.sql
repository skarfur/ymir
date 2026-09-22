-- Promotes activity_templates from an app_config JSON blob to a real
-- table, mirroring the boats/locations precedent (see
-- 20260918200755_core_identity_and_reference_data.sql's header: "a
-- deliberate normalization from the Sheets version's config-JSON-blobs,
-- not a shortcut").
--
-- This fixes a live bug, not just a tidiness issue: activity_templates
-- ids were the legacy 16-char uid_() hex string (e.g.
-- "82165041fc8a46bf"), but public.activities.activity_type_id /
-- .source_activity_type_id are real `uuid` columns (see
-- 20260921020000_activity_types.sql's own header comment, which already
-- flagged this mismatch for *newly created* templates — save_activity_type
-- generates a real gen_random_uuid() for those). The 15 templates
-- imported from the Sheets export never got that treatment:
--   - cancel_class_occurrence's `p_class_id::uuid` cast throws
--     invalid_text_representation for every one of them, so "cancel this
--     occurrence" silently no-ops (swallowed into a generic error).
--   - volunteer-signup's asUuid(ve.sourceActivityTypeId) returns null for
--     the same reason, so a materialized signup row's
--     source_activity_type_id would silently be null.
-- public.activities currently has zero rows referencing these ids, so
-- there's nothing to backfill — this is the last moment to fix the id
-- shape before real cancellations/signups accumulate against it.
--
-- bulk_schedule and roles stay as jsonb sub-columns (the recurrence rule
-- and the per-event role list respectively) — this is not a full
-- normalization, just giving the template record itself real top-level
-- columns for what's actually queried/filtered, same scope as boats'
-- access_allowlist or activities' own roles/participants columns.
--
-- leader_member_id stays free-text (not a uuid FK): the imported data
-- holds legacy placeholder values ("1", "3") that are neither valid
-- kennitalas nor member uuids — inventing real member references for
-- them would be fabricating data, not fixing a bug. This mirrors the
-- documented free-text-vs-real-FK split used elsewhere in this migration
-- series (filed_by, reported_by, verkstjori, etc.).

create table public.activity_templates (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null default '',
  name_is               text not null default '',
  active                boolean not null default true,
  class_tag             text not null default '',
  class_tag_is          text not null default '',
  calendar_id           text not null default '',
  calendar_sync_active  boolean not null default false,
  schedule_source       text not null default 'bulk' check (schedule_source in ('bulk', 'calendar')),
  volunteer             boolean not null default false,
  roles                 jsonb not null default '[]',
  leader_member_id      text not null default '',
  leader_name           text not null default '',
  leader_phone          text not null default '',
  show_leader_phone     boolean not null default false,
  default_start         text not null default '',
  default_end           text not null default '',
  bulk_schedule         jsonb,
  reserved_boat_ids     jsonb not null default '[]',
  gcal_series_event_id  text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.activity_templates enable row level security;
revoke all on public.activity_templates from anon, authenticated;

-- ── save_activity_type ──────────────────────────────────────────────────
-- Same external signature as the version this replaces (20260921020000);
-- admin/act-types.js's callSupabaseRpc('save_activity_type', {...}) needs
-- no changes. Internally: upsert into the real table instead of
-- read-modify-write on the whole app_config array — this also removes the
-- clobbering risk the old version had (two admins editing different
-- templates concurrently could race on the same jsonb column write).
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
  item_id uuid;
  is_vol boolean := coalesce(p_volunteer, false);
  saved public.activity_templates;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if coalesce(trim(p_leader_member_id), '') = '' and coalesce(trim(p_leader_name), '') = '' then
    raise exception 'saveActivityType failed: leader is required';
  end if;

  if nullif(trim(p_id), '') is null then
    item_id := gen_random_uuid();
  else
    begin
      item_id := trim(p_id)::uuid;
    exception when invalid_text_representation then
      raise exception 'saveActivityType failed: invalid id';
    end;
  end if;

  insert into public.activity_templates (
    id, name, name_is, active, class_tag, class_tag_is, calendar_id, calendar_sync_active,
    schedule_source, volunteer, roles, leader_member_id, leader_name, leader_phone,
    show_leader_phone, default_start, default_end, bulk_schedule, reserved_boat_ids, updated_at
  ) values (
    item_id, coalesce(p_name, ''), coalesce(p_name_is, ''), coalesce(p_active, true),
    coalesce(p_class_tag, ''), coalesce(p_class_tag_is, ''),
    coalesce(p_calendar_id, ''), coalesce(p_calendar_sync_active, false),
    schedule_source, is_vol,
    case when is_vol then coalesce(p_roles, '[]'::jsonb) else '[]'::jsonb end,
    coalesce(p_leader_member_id, ''), coalesce(p_leader_name, ''),
    coalesce(p_leader_phone, ''), coalesce(p_show_leader_phone, false),
    coalesce(p_default_start, ''), coalesce(p_default_end, ''),
    p_bulk_schedule, coalesce(p_reserved_boat_ids, '[]'::jsonb), now()
  )
  on conflict (id) do update set
    name = excluded.name, name_is = excluded.name_is, active = excluded.active,
    class_tag = excluded.class_tag, class_tag_is = excluded.class_tag_is,
    calendar_id = excluded.calendar_id, calendar_sync_active = excluded.calendar_sync_active,
    schedule_source = excluded.schedule_source, volunteer = excluded.volunteer,
    roles = excluded.roles, leader_member_id = excluded.leader_member_id,
    leader_name = excluded.leader_name, leader_phone = excluded.leader_phone,
    show_leader_phone = excluded.show_leader_phone, default_start = excluded.default_start,
    default_end = excluded.default_end, bulk_schedule = excluded.bulk_schedule,
    reserved_boat_ids = excluded.reserved_boat_ids, updated_at = now()
  returning * into saved;

  return jsonb_build_object('id', saved.id, 'item', jsonb_build_object(
    'id', saved.id, 'name', saved.name, 'nameIS', saved.name_is, 'active', saved.active,
    'classTag', saved.class_tag, 'classTagIS', saved.class_tag_is,
    'calendarId', saved.calendar_id, 'calendarSyncActive', saved.calendar_sync_active,
    'scheduleSource', saved.schedule_source, 'volunteer', saved.volunteer, 'roles', saved.roles,
    'leaderMemberId', saved.leader_member_id, 'leaderName', saved.leader_name,
    'leaderPhone', saved.leader_phone, 'showLeaderPhone', saved.show_leader_phone,
    'defaultStart', saved.default_start, 'defaultEnd', saved.default_end,
    'bulkSchedule', saved.bulk_schedule, 'reservedBoatIds', saved.reserved_boat_ids,
    'gcalSeriesEventId', saved.gcal_series_event_id,
    'createdAt', saved.created_at, 'updatedAt', saved.updated_at
  ));
end;
$$;
revoke execute on function public.save_activity_type(
  text, text, text, boolean, text, text, text, boolean, text, boolean, jsonb, text, text, text, boolean, text, text, jsonb, jsonb
) from public, anon;
grant execute on function public.save_activity_type(
  text, text, text, boolean, text, text, text, boolean, text, boolean, jsonb, text, text, text, boolean, text, text, jsonb, jsonb
) to authenticated;

-- ── delete_activity_type ────────────────────────────────────────────────
-- Same cascade behaviour as before (removes linked volunteer-event
-- activities + their signups), now against a real table + a real uuid
-- comparison instead of an app_config array rewrite.
create or replace function public.delete_activity_type(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_uuid uuid;
  ev_ids uuid[];
  removed_events int := 0;
  removed_signups int := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_id is null or p_id = '' then
    raise exception 'id required';
  end if;

  begin
    type_uuid := p_id::uuid;
  exception when invalid_text_representation then
    type_uuid := null;
  end;

  if type_uuid is not null then
    delete from public.activity_templates where id = type_uuid;

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

-- ── cancel_class_occurrence ─────────────────────────────────────────────
-- Same tombstone-upsert behaviour as 20260921160000, now a plain indexed
-- lookup against activity_templates instead of a jsonb_array_elements
-- scan over the app_config blob. restore_class_occurrence needs no
-- change — it never read activity_templates in the first place.
create or replace function public.cancel_class_occurrence(p_class_id text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  class_uuid uuid;
  existing_id uuid;
  tmpl public.activity_templates;
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

  select * into tmpl from public.activity_templates where id = class_uuid;

  select id into existing_id from public.activities
    where source_activity_type_id = class_uuid and date = p_date and signup_required = false
    limit 1;

  if existing_id is not null then
    update public.activities set
      status = 'cancelled',
      activity_type_id = class_uuid,
      title = coalesce(tmpl.name, title),
      title_is = coalesce(tmpl.name_is, title_is),
      updated_at = now()
    where id = existing_id;
  else
    insert into public.activities (
      signup_required, status, source_activity_type_id, activity_type_id,
      date, title, title_is, actor_id
    ) values (
      false, 'cancelled', class_uuid, class_uuid,
      p_date, coalesce(tmpl.name, ''), coalesce(tmpl.name_is, ''),
      public.current_member_id()
    );
  end if;

  return jsonb_build_object('cancelled', true);
end;
$$;
revoke execute on function public.cancel_class_occurrence(text, date) from public, anon;
grant execute on function public.cancel_class_occurrence(text, date) to authenticated;

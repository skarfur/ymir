-- The already-deployed create-incident Edge Function has been inserting
-- hand_off_name into a column that was never actually created (confirmed
-- against information_schema.columns) — every call to it has been
-- failing with "column hand_off_name does not exist" in production.
-- Found while porting; fixed here rather than left for whenever someone
-- next tries to hand off an incident and gets a 500.
alter table public.incidents add column if not exists hand_off_name text not null default '';

-- Phase 3, domain 2: incidents.gs's createIncident_/resolveIncident_/
-- addIncidentNote_.
--
-- createIncident_ has no role gate (called from both the incidents
-- portal and the member hub's self-report flow — any authenticated
-- session). It's an RPC rather than a plain PostgREST insert because the
-- original defensively coerces locationId/boatId to a valid uuid-or-null
-- (UUID_RE.test(...) ? id : null) rather than erroring on a malformed
-- value — a real concern right now since nothing writes real rows into
-- boats/locations yet (see the boats/locations CRUD gap flagged
-- separately), so a client-sent id there may not be a real uuid at all.
-- A plain PostgREST insert would 400 the whole incident report on a bad
-- id instead of just dropping that one reference, same as the original.
create or replace function public.create_incident(
  p_types jsonb default '[]'::jsonb,
  p_severity text default 'minor',
  p_date date default null,
  p_time time default null,
  p_location_id text default '',
  p_location_name text default '',
  p_boat_id text default '',
  p_boat_name text default '',
  p_description text default '',
  p_involved text default '',
  p_witnesses text default '',
  p_immediate_action text default '',
  p_follow_up text default '',
  p_hand_off_to text default '',
  p_hand_off_name text default '',
  p_hand_off_notes text default '',
  p_filed_by text default '',
  p_status text default 'closed',
  p_resolved boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  loc_uuid uuid;
  boat_uuid uuid;
  ts timestamptz := now();
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  begin
    loc_uuid := nullif(p_location_id, '')::uuid;
  exception when invalid_text_representation then
    loc_uuid := null;
  end;
  begin
    boat_uuid := nullif(p_boat_id, '')::uuid;
  exception when invalid_text_representation then
    boat_uuid := null;
  end;

  insert into public.incidents (
    types, severity, date, time, location_id, location_name, boat_id, boat_name,
    description, involved, witnesses, immediate_action, follow_up,
    hand_off_to, hand_off_name, hand_off_notes, filed_by,
    resolved, resolved_at, status
  ) values (
    coalesce(p_types, '[]'::jsonb), coalesce(nullif(p_severity, ''), 'minor'),
    coalesce(p_date, current_date), coalesce(p_time, current_time),
    loc_uuid, coalesce(p_location_name, ''), boat_uuid, coalesce(p_boat_name, ''),
    coalesce(p_description, ''), coalesce(p_involved, ''), coalesce(p_witnesses, ''),
    coalesce(p_immediate_action, ''), coalesce(p_follow_up, ''),
    coalesce(p_hand_off_to, ''), coalesce(p_hand_off_name, ''), coalesce(p_hand_off_notes, ''),
    coalesce(p_filed_by, ''),
    coalesce(p_resolved, false), case when p_resolved then ts else null end,
    case when p_status = 'review' then 'review' else 'closed' end
  ) returning id into new_id;

  return jsonb_build_object('id', new_id, 'created', true);
end;
$$;
revoke execute on function public.create_incident(
  jsonb, text, date, time, text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean
) from public, anon;
grant execute on function public.create_incident(
  jsonb, text, date, time, text, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean
) to authenticated;

-- resolveIncident_/addIncidentNote_ are both STAFF_ACTIONS_-gated.
-- resolveIncident_ is a plain field flip — direct PostgREST PATCH under
-- RLS covers it (see the SELECT+UPDATE policies below; SELECT is needed
-- for the id-filtered WHERE clause itself, same lesson as every other
-- id-filtered UPDATE this migration). addIncidentNote_ appends to a
-- JSON-string column (staff_notes/reviewer_notes are `text`, holding a
-- JSON-encoded array — not jsonb — matching the Sheets cell format
-- exactly), which needs atomic read-modify-write server-side, so it
-- stays an RPC.
create policy incidents_staff_select on public.incidents
  for select to authenticated
  using (public.is_staff_or_admin());

create policy incidents_staff_update on public.incidents
  for update to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

grant select, update on public.incidents to authenticated;

create or replace function public.add_incident_note(
  p_id uuid,
  p_kind text default 'staff',
  p_by text default '',
  p_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_reviewer boolean := (p_kind = 'reviewer');
  cur text;
  notes jsonb;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;

  if is_reviewer then
    select reviewer_notes into cur from public.incidents where id = p_id;
  else
    select staff_notes into cur from public.incidents where id = p_id;
  end if;

  begin
    notes := coalesce(nullif(cur, ''), '[]')::jsonb;
  exception when others then
    notes := '[]'::jsonb;
  end;
  notes := notes || jsonb_build_array(jsonb_build_object('by', coalesce(p_by, ''), 'at', now(), 'text', coalesce(p_text, '')));

  if is_reviewer then
    update public.incidents set reviewer_notes = notes::text where id = p_id;
  else
    update public.incidents set staff_notes = notes::text where id = p_id;
  end if;

  return jsonb_build_object('updated', true);
end;
$$;
revoke execute on function public.add_incident_note(uuid, text, text, text) from public, anon;
grant execute on function public.add_incident_note(uuid, text, text, text) to authenticated;

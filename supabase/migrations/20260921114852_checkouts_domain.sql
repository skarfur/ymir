-- Phase 3, domain: checkouts.gs's checkout sub-domain (single/group
-- checkout + check-in + boat OOS/access + date-range reservations).
-- Explicitly NOT included here (separate sub-domains within the same
-- checkouts.gs file, per the Phase 3 scope breakdown): reservation slots
-- (saveSlot_/bookSlot_/etc) and crews (createCrew_/joinCrew_/etc).
--
-- ⚠ SECURITY NOTE, not fixed in this migration: the original saveCheckout_
-- has a substantial controlled-access boat gate (owner/cert-gate/allowlist/
-- date-range-reservation/slot-booking checks against config.gs's cert-gate
-- helpers) that the CURRENTLY DEPLOYED save-checkout Edge Function already
-- stubs out entirely (its own header comment claims the boats table lacks
-- the access-control columns — which is now false; save-boat-oos et al
-- prove the columns exist). So the gate has been unenforced in production
-- since that Edge Function shipped. save_checkout below faithfully ports
-- the CURRENTLY DEPLOYED (stubbed) behavior rather than silently
-- reinstating a materially different security behavior mid-retrofit —
-- reinstating the full gate is tracked as a separate follow-up task.

create or replace function public.checkouts_time_to_ts_(p_hhmm text, p_date date default current_date)
returns timestamptz
language plpgsql
as $$
declare
  m text[];
begin
  if p_hhmm is null or trim(p_hhmm) = '' then
    return null;
  end if;
  m := regexp_match(trim(p_hhmm), '^(\d{1,2}):(\d{2})');
  if m is null then
    return null;
  end if;
  return (p_date::text || 'T' || lpad(m[1], 2, '0') || ':' || m[2] || ':00Z')::timestamptz;
end;
$$;

create or replace function public.normalize_wx_snapshot_(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  ws_raw jsonb;
  ws_out jsonb;
begin
  if p is null or p = '{}'::jsonb then
    return null;
  end if;
  ws_raw := p->'ws';
  if jsonb_typeof(ws_raw) = 'string' and (ws_raw#>>'{}') like '%-%' then
    ws_out := ws_raw;
  else
    ws_out := to_jsonb(round(coalesce((p->>'ws')::numeric, 0)));
  end if;
  return jsonb_build_object(
    'bft', round(coalesce((p->>'bft')::numeric, 0)),
    'ws', ws_out,
    'wg', round(coalesce((p->>'wg')::numeric, 0)),
    'dir', coalesce(p->>'dir', p->>'wDir', ''),
    'wv', case when p->>'wv' is not null then round((p->>'wv')::numeric, 1)
               when p->>'waveH' is not null then round((p->>'waveH')::numeric, 1)
               else null end,
    'flag', coalesce(p->>'flag', p->>'flagKey', ''),
    'tc', case when p->>'tc' is not null then round((p->>'tc')::numeric)
               when p->>'airT' is not null then round((p->>'airT')::numeric)
               else null end,
    'ts', coalesce(p->>'ts', now()::text)
  );
exception when others then
  return null;
end;
$$;

create or replace function public.jsonb_text_array_join_(p jsonb, sep text default ', ')
returns text
language sql
immutable
as $$
  select coalesce(string_agg(x, sep), '') from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) x;
$$;

create or replace function public.boat_reservations_json_(p_boat_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'memberKennitala', r.member_kennitala, 'memberName', r.member_name,
    'startDate', r.start_date, 'endDate', r.end_date, 'note', coalesce(r.note, '')
  ) order by r.start_date), '[]'::jsonb)
  from public.boat_reservations r where r.boat_id = p_boat_id;
$$;

create or replace function public.boat_dto_(b public.boats)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'category', b.category, 'active', b.active,
    'oos', coalesce(b.oos, false), 'oosReason', coalesce(b.oos_reason, ''),
    'defaultPortId', coalesce(b.default_port_id::text, ''),
    'registrationNo', coalesce(b.registration_no, ''), 'typeModel', coalesce(b.type_model, ''),
    'loa', b.loa, 'ownership', coalesce(b.ownership, 'club'),
    'ownerId', coalesce(b.owner_kennitala, ''), 'ownerName', coalesce(b.owner_name, ''),
    'accessMode', coalesce(b.access_mode, 'free'), 'accessGate', b.access_gate,
    'accessGateCert', coalesce(b.access_gate_cert, ''),
    'accessAllowlist', coalesce(b.access_allowlist, '[]'::jsonb),
    'slotSchedulingEnabled', coalesce(b.slot_scheduling_enabled, false),
    'availableOutsideSlots', coalesce(b.available_outside_slots, true),
    'reservations', public.boat_reservations_json_(b.id)
  );
$$;

revoke execute on function public.checkouts_time_to_ts_(text, date) from public, anon, authenticated;
revoke execute on function public.normalize_wx_snapshot_(jsonb) from public, anon, authenticated;
revoke execute on function public.jsonb_text_array_join_(jsonb, text) from public, anon, authenticated;
revoke execute on function public.boat_reservations_json_(uuid) from public, anon, authenticated;
revoke execute on function public.boat_dto_(public.boats) from public, anon, authenticated;

-- ── saveCheckout_ ───────────────────────────────────────────────────────
create or replace function public.save_checkout(
  p_member_kennitala text,
  p_member_name text default '',
  p_boat_id text default '',
  p_boat_name text default '',
  p_boat_category text default '',
  p_location_id text default '',
  p_location_name text default '',
  p_crew int default 1,
  p_crew_names jsonb default '[]'::jsonb,
  p_checked_out_at text default null,
  p_expected_return text default null,
  p_wx_snapshot jsonb default null,
  p_pre_launch_checklist jsonb default null,
  p_notes text default '',
  p_non_club boolean default false,
  p_departure_port text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  kt text := trim(coalesce(p_member_kennitala, ''));
  mem record;
  guardian_name text := '';
  guardian_phone text := '';
  is_minor boolean := false;
  boat_uuid uuid := null;
  loc_uuid uuid := null;
  today date := current_date;
  new_id uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if kt = '' then
    raise exception 'memberKennitala required';
  end if;

  select id, phone, birth_year into mem from public.members where kennitala = kt;
  if not found then
    raise exception 'Member not found';
  end if;

  select g.name, g.phone into guardian_name, guardian_phone
    from public.guardians g where g.member_id = mem.id limit 1;
  guardian_name := coalesce(guardian_name, '');
  guardian_phone := coalesce(guardian_phone, '');
  is_minor := mem.birth_year is not null and (extract(year from now())::int - mem.birth_year) < 18;

  if not p_non_club and p_boat_id is not null and p_boat_id ~* uuid_re then
    select id into boat_uuid from public.boats where id = p_boat_id::uuid;
  end if;
  if not p_non_club and p_location_id is not null and p_location_id ~* uuid_re then
    select id into loc_uuid from public.locations where id = p_location_id::uuid;
  end if;

  insert into public.checkouts (
    member_id, member_kennitala, member_name, boat_id, boat_name, boat_category,
    location_id, location_name, crew_count, crew, expected_return, wx_snapshot,
    pre_launch_checklist, notes, status, departure_port, non_club,
    member_phone, member_is_minor, guardian_name, guardian_phone, actor_id, checked_out_at
  ) values (
    mem.id, kt, coalesce(p_member_name, ''), boat_uuid, coalesce(p_boat_name, ''), coalesce(p_boat_category, ''),
    loc_uuid, coalesce(p_location_name, ''), coalesce(p_crew, 1), coalesce(p_crew_names, '[]'::jsonb),
    public.checkouts_time_to_ts_(p_expected_return, today), public.normalize_wx_snapshot_(p_wx_snapshot),
    p_pre_launch_checklist, coalesce(p_notes, ''), 'out', coalesce(p_departure_port, ''), coalesce(p_non_club, false),
    coalesce(mem.phone, ''), is_minor, guardian_name, guardian_phone, public.current_member_id(),
    coalesce(public.checkouts_time_to_ts_(p_checked_out_at, today), now())
  ) returning id into new_id;

  return jsonb_build_object('id', new_id, 'created', true);
end;
$$;
revoke execute on function public.save_checkout(text,text,text,text,text,text,text,int,jsonb,text,text,jsonb,jsonb,text,boolean,text) from public, anon;
grant execute on function public.save_checkout(text,text,text,text,text,text,text,int,jsonb,text,text,jsonb,jsonb,text,boolean,text) to authenticated;

-- ── checkIn_ ────────────────────────────────────────────────────────────
create or replace function public.check_in(
  p_id uuid,
  p_time_in text default null,
  p_after_sail_checklist jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_in_ts timestamptz;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;
  checked_in_ts := coalesce(public.checkouts_time_to_ts_(p_time_in, current_date), now());

  update public.checkouts set
    status = 'in',
    checked_in_at = checked_in_ts,
    actor_id = public.current_member_id(),
    after_sail_checklist = coalesce(p_after_sail_checklist, after_sail_checklist)
  where id = p_id;

  return jsonb_build_object('updated', true, 'checkedInAt', to_char(checked_in_ts at time zone 'UTC', 'HH24:MI'));
end;
$$;
revoke execute on function public.check_in(uuid, text, jsonb) from public, anon;
grant execute on function public.check_in(uuid, text, jsonb) to authenticated;

-- ── deleteCheckout_ (STAFF_ACTIONS_) ──────────────────────────────────────
create or replace function public.delete_checkout(p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;
  delete from public.checkouts where id = p_id returning id into deleted_id;
  return jsonb_build_object('deleted', deleted_id is not null);
end;
$$;
revoke execute on function public.delete_checkout(uuid) from public, anon;
grant execute on function public.delete_checkout(uuid) to authenticated;

-- ── saveGroupCheckout_ (STAFF_ACTIONS_) ───────────────────────────────────
create or replace function public.save_group_checkout(
  p_boat_ids jsonb default '[]'::jsonb,
  p_boat_names jsonb default '[]'::jsonb,
  p_boat_category text default '',
  p_staff_names jsonb default '[]'::jsonb,
  p_staff_kennitalar jsonb default '[]'::jsonb,
  p_location_id text default '',
  p_location_name text default '',
  p_crew int default null,
  p_participants int default 0,
  p_checked_out_at text default null,
  p_expected_return text default null,
  p_wx_snapshot jsonb default null,
  p_activity_type_id text default '',
  p_activity_type_name text default '',
  p_linked_activity_id text default '',
  p_class_tag text default '',
  p_new_activity jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := current_date;
  loc_uuid uuid := null;
  act_type_uuid uuid := null;
  linked_activity_id uuid := null;
  class_tag text := coalesce(p_class_tag, '');
  new_act_id uuid;
  crew_count int;
  staff_name_join text;
  new_id uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;

  if p_linked_activity_id is not null and p_linked_activity_id ~* uuid_re then
    linked_activity_id := p_linked_activity_id::uuid;
  end if;

  if p_new_activity is not null and jsonb_typeof(p_new_activity) = 'object'
     and (coalesce(p_new_activity->>'name', '') <> '' or coalesce(p_new_activity->>'classTag', '') <> '') then
    insert into public.activities (
      signup_required, status, source, date, start_time, end_time, title, actor_id
    ) values (
      false, 'upcoming', 'manual', today,
      nullif(coalesce(p_new_activity->>'startTime', p_checked_out_at), '')::time,
      nullif(coalesce(p_new_activity->>'endTime', p_expected_return), '')::time,
      coalesce(nullif(p_new_activity->>'name', ''), p_new_activity->>'classTag', ''),
      public.current_member_id()
    ) returning id into new_act_id;
    linked_activity_id := new_act_id;
    if class_tag = '' then
      class_tag := coalesce(p_new_activity->>'classTag', '');
    end if;
  end if;

  if p_location_id is not null and p_location_id ~* uuid_re then
    select id into loc_uuid from public.locations where id = p_location_id::uuid;
  end if;
  if p_activity_type_id is not null and p_activity_type_id ~* uuid_re then
    act_type_uuid := p_activity_type_id::uuid;
  end if;

  crew_count := coalesce(p_crew, coalesce(p_participants, 0) + jsonb_array_length(coalesce(p_staff_names, '[]'::jsonb)));
  staff_name_join := public.jsonb_text_array_join_(p_staff_names, ', ');

  insert into public.checkouts (
    boat_id, boat_ids, boat_name, boat_names, boat_category,
    member_id, member_kennitala, member_name, crew_count,
    location_id, location_name, expected_return, wx_snapshot, notes, status,
    is_group, participants_count, staff_names, staff_kennitalar,
    activity_type_id, activity_type_name, linked_activity_id, class_tag,
    actor_id, checked_out_at
  ) values (
    null, coalesce(p_boat_ids, '[]'::jsonb), public.jsonb_text_array_join_(p_boat_names, ', '), coalesce(p_boat_names, '[]'::jsonb), coalesce(p_boat_category, ''),
    null, '', case when staff_name_join <> '' then staff_name_join else 'Group' end, crew_count,
    loc_uuid, coalesce(p_location_name, ''), public.checkouts_time_to_ts_(p_expected_return, today), public.normalize_wx_snapshot_(p_wx_snapshot), '', 'out',
    true, coalesce(p_participants, 0), coalesce(p_staff_names, '[]'::jsonb), coalesce(p_staff_kennitalar, '[]'::jsonb),
    act_type_uuid, coalesce(p_activity_type_name, ''), linked_activity_id, class_tag,
    public.current_member_id(), coalesce(public.checkouts_time_to_ts_(p_checked_out_at, today), now())
  ) returning id into new_id;

  return jsonb_build_object('id', new_id, 'created', true, 'linkedActivityId', coalesce(linked_activity_id::text, ''), 'classTag', class_tag);
end;
$$;
revoke execute on function public.save_group_checkout(jsonb,jsonb,text,jsonb,jsonb,text,text,int,int,text,text,jsonb,text,text,text,text,jsonb) from public, anon;
grant execute on function public.save_group_checkout(jsonb,jsonb,text,jsonb,jsonb,text,text,int,int,text,text,jsonb,text,text,text,text,jsonb) to authenticated;

-- ── groupCheckIn_ + createSupervisorTripsForGroup_ (STAFF_ACTIONS_) ──────
create or replace function public.create_supervisor_trips_for_group_(
  p_checkout_id uuid, p_checked_in_at timestamptz, p_actor_id uuid
) returns int
language plpgsql
set search_path = ''
as $$
declare
  co record;
  staff_names text[];
  staff_kts text[];
  seen_kt text[] := '{}';
  time_out text;
  time_in text;
  hours_decimal numeric := 0;
  mins int;
  oh int; om int; ih int; im int;
  n int := 0;
  i int;
  kt text;
  nm text;
  mem_id uuid;
  d date := current_date;
begin
  select * into co from public.checkouts where id = p_checkout_id;
  if not found then
    return 0;
  end if;
  select array(select jsonb_array_elements_text(coalesce(co.staff_names, '[]'::jsonb))) into staff_names;
  select array(select jsonb_array_elements_text(coalesce(co.staff_kennitalar, '[]'::jsonb))) into staff_kts;
  if staff_kts is null or array_length(staff_kts, 1) is null then
    return 0;
  end if;

  select array_agg(distinct member_kennitala) into seen_kt
    from public.trips where linked_checkout_id = p_checkout_id and member_kennitala is not null;
  seen_kt := coalesce(seen_kt, '{}');

  time_out := to_char(co.checked_out_at at time zone 'UTC', 'HH24:MI');
  time_in := to_char(p_checked_in_at at time zone 'UTC', 'HH24:MI');
  if time_out is not null and time_in is not null then
    oh := split_part(time_out, ':', 1)::int; om := split_part(time_out, ':', 2)::int;
    ih := split_part(time_in, ':', 1)::int; im := split_part(time_in, ':', 2)::int;
    mins := (ih * 60 + im) - (oh * 60 + om);
    if mins < 0 then mins := mins + 1440; end if;
    hours_decimal := round((mins / 60.0)::numeric, 2);
  end if;

  for i in 1 .. array_length(staff_kts, 1) loop
    kt := trim(staff_kts[i]);
    continue when kt = '' or kt = any(seen_kt);
    nm := coalesce(staff_names[i], '');
    select id into mem_id from public.members where kennitala = kt;
    insert into public.trips (
      member_id, member_kennitala, member_name, date, time_out, time_in, hours_decimal,
      boat_id, boat_name, boat_category, location_id, location_name, crew_count, role,
      wx_snapshot, notes, is_linked, linked_checkout_id, departure_port, actor_id
    ) values (
      mem_id, kt, nm, d, public.checkouts_time_to_ts_(time_out, d), public.checkouts_time_to_ts_(time_in, d), hours_decimal,
      co.boat_id, coalesce(co.boat_name, ''), coalesce(co.boat_category, ''), co.location_id, coalesce(co.location_name, ''),
      coalesce(co.crew_count, 0), 'supervisor', co.wx_snapshot, '', true, p_checkout_id, coalesce(co.departure_port, ''), p_actor_id
    );
    n := n + 1;
    seen_kt := seen_kt || kt;
  end loop;

  return n;
end;
$$;
revoke execute on function public.create_supervisor_trips_for_group_(uuid, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.group_check_in(p_id uuid, p_time_in text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_in_ts timestamptz;
  trips_created int := 0;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;
  checked_in_ts := coalesce(public.checkouts_time_to_ts_(p_time_in, current_date), now());

  update public.checkouts set
    status = 'in', checked_in_at = checked_in_ts, actor_id = public.current_member_id()
  where id = p_id;

  begin
    trips_created := public.create_supervisor_trips_for_group_(p_id, checked_in_ts, public.current_member_id());
  exception when others then
    trips_created := 0;
  end;

  return jsonb_build_object('updated', true, 'checkedInAt', to_char(checked_in_ts at time zone 'UTC', 'HH24:MI'), 'tripsCreated', trips_created);
end;
$$;
revoke execute on function public.group_check_in(uuid, text) from public, anon;
grant execute on function public.group_check_in(uuid, text) to authenticated;

-- ── saveBoatOos_ / saveBoatAccess_ / saveReservation_ / removeReservation_ ─
create or replace function public.save_boat_oos(p_id uuid, p_oos boolean default null, p_oos_reason text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boats;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;

  if p_oos is not null or p_oos_reason is not null then
    update public.boats set
      oos = coalesce(p_oos, oos),
      oos_reason = coalesce(p_oos_reason, oos_reason)
    where id = p_id
    returning * into b;
  else
    select * into b from public.boats where id = p_id;
  end if;

  if not found then
    raise exception 'Boat not found';
  end if;

  return jsonb_build_object('updated', true, 'boat', public.boat_dto_(b));
end;
$$;
revoke execute on function public.save_boat_oos(uuid, boolean, text) from public, anon;
grant execute on function public.save_boat_oos(uuid, boolean, text) to authenticated;

create or replace function public.save_boat_access(
  p_boat_id uuid,
  p_access_mode text default null,
  p_access_gate jsonb default null,
  p_access_gate_cert text default null,
  p_access_allowlist jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boats;
  gate jsonb := null;
  gate_cert text := null;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_boat_id is null then
    raise exception 'boatId required';
  end if;

  if p_access_gate is not null then
    if jsonb_typeof(p_access_gate) = 'object' and coalesce(p_access_gate->>'certId', '') <> '' then
      gate := jsonb_build_object(
        'certId', p_access_gate->>'certId',
        'sub', coalesce(p_access_gate->>'sub', ''),
        'minRank', coalesce((p_access_gate->>'minRank')::numeric, 0)
      );
      gate_cert := nullif(gate->>'sub', '');
      if gate_cert is null then gate_cert := gate->>'certId'; end if;
    end if;
  elsif p_access_gate_cert is not null then
    gate_cert := nullif(p_access_gate_cert, '');
  end if;

  update public.boats set
    access_mode = case when p_access_mode is not null then (case when p_access_mode = 'controlled' then 'controlled' else 'free' end) else access_mode end,
    access_gate = case when p_access_gate is not null or p_access_gate_cert is not null then gate else access_gate end,
    access_gate_cert = case when p_access_gate is not null or p_access_gate_cert is not null then coalesce(gate_cert, '') else access_gate_cert end,
    access_allowlist = case when p_access_allowlist is not null then p_access_allowlist else access_allowlist end
  where id = p_boat_id
  returning * into b;

  if not found then
    raise exception 'Boat not found';
  end if;

  return jsonb_build_object('updated', true, 'boat', public.boat_dto_(b));
end;
$$;
revoke execute on function public.save_boat_access(uuid, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.save_boat_access(uuid, text, jsonb, text, jsonb) to authenticated;

create or replace function public.save_reservation(
  p_boat_id uuid,
  p_member_kennitala text,
  p_member_name text,
  p_start_date date,
  p_end_date date,
  p_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boats;
  mem_id uuid;
  new_res public.boat_reservations;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_boat_id is null then raise exception 'boatId required'; end if;
  if coalesce(trim(p_member_kennitala), '') = '' or coalesce(trim(p_member_name), '') = '' then
    raise exception 'member required';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'startDate and endDate required';
  end if;

  select * into b from public.boats where id = p_boat_id;
  if not found then raise exception 'Boat not found'; end if;

  select id into mem_id from public.members where kennitala = trim(p_member_kennitala);

  insert into public.boat_reservations (boat_id, member_id, member_kennitala, member_name, start_date, end_date, note)
  values (p_boat_id, mem_id, trim(p_member_kennitala), trim(p_member_name), p_start_date, p_end_date, coalesce(p_note, ''))
  returning * into new_res;

  return jsonb_build_object(
    'updated', true,
    'boat', public.boat_dto_(b),
    'reservation', jsonb_build_object(
      'id', new_res.id, 'memberKennitala', new_res.member_kennitala, 'memberName', new_res.member_name,
      'startDate', new_res.start_date, 'endDate', new_res.end_date, 'note', coalesce(new_res.note, '')
    )
  );
end;
$$;
revoke execute on function public.save_reservation(uuid, text, text, date, date, text) from public, anon;
grant execute on function public.save_reservation(uuid, text, text, date, date, text) to authenticated;

create or replace function public.remove_reservation(p_boat_id uuid, p_reservation_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.boats;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_boat_id is null then raise exception 'boatId required'; end if;
  if p_reservation_id is null then raise exception 'reservationId required'; end if;

  select * into b from public.boats where id = p_boat_id;
  if not found then raise exception 'Boat not found'; end if;

  delete from public.boat_reservations where id = p_reservation_id and boat_id = p_boat_id;

  return jsonb_build_object('updated', true, 'boat', public.boat_dto_(b));
end;
$$;
revoke execute on function public.remove_reservation(uuid, uuid) from public, anon;
grant execute on function public.remove_reservation(uuid, uuid) to authenticated;

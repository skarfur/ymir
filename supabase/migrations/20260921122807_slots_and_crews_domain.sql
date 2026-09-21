-- Phase 3, remaining checkouts.gs sub-domains: reservation slots and
-- crews. Matches the CURRENTLY DEPLOYED Edge Functions' baseline exactly
-- (same deferrals, documented in their own header comments):
--   - Google Calendar sync (syncSlotToCalendar_/deleteSlotCalendarEvent_)
--     is not ported — Apps-Script-only integration, out of scope.
--   - Virtual (vslot-*) class-slot materialization is not ported —
--     depends on activity_templates data that doesn't exist yet. Moot
--     here since slot ids are real uuids; no vslot- id can reach these
--     functions.
--   - The keelboat cert-access gate (getCertDefsFromMap_/normalizeAccessGate_/
--     memberHasGate_) in bookSlot_/bulkBookSlots_ is stubbed, same as
--     save-checkout's controlled-access boat gate — tracked together as
--     one follow-up (task queued separately).
-- None of these 14 actions were staff/admin-gated in code.gs's
-- ADMIN_ACTIONS_/STAFF_ACTIONS_ maps — all stay session-only.

create or replace function public.slot_has_conflict_(
  p_boat_id uuid, p_date date, p_start_time time, p_end_time time, p_exclude_id uuid default null
) returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_end_time > p_start_time) and exists (
    select 1 from public.reservation_slots sl
    where sl.boat_id = p_boat_id and sl.date = p_date
      and (p_exclude_id is null or sl.id <> p_exclude_id)
      and p_start_time < sl.end_time and p_end_time > sl.start_time
  );
$$;
revoke execute on function public.slot_has_conflict_(uuid, date, time, time, uuid) from public, anon, authenticated;

create or replace function public.crew_pairs_has_member_(p_pairs jsonb, p_kennitala text) returns boolean
language sql
stable
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) p,
                   jsonb_array_elements(coalesce(p->'members', '[]'::jsonb)) m
    where m->>'kennitala' = p_kennitala
  );
$$;
revoke execute on function public.crew_pairs_has_member_(jsonb, text) from public, anon, authenticated;

create or replace function public.crew_find_pair_index_(p_pairs jsonb, p_pair_id text) returns int
language sql
stable
as $$
  select (ord - 1)::int from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) with ordinality as t(elem, ord)
  where elem->>'pairId' = p_pair_id
  limit 1;
$$;
revoke execute on function public.crew_find_pair_index_(jsonb, text) from public, anon, authenticated;

create or replace function public.crew_total_members_(p_pairs jsonb) returns int
language sql
stable
as $$
  select count(*)::int from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) p,
                             jsonb_array_elements(coalesce(p->'members', '[]'::jsonb)) m
  where m <> 'null'::jsonb;
$$;
revoke execute on function public.crew_total_members_(jsonb) from public, anon, authenticated;

-- ═══════════════════════════════ RESERVATION SLOTS ═══════════════════════════

create or replace function public.save_slot(
  p_boat_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_slot_id uuid default null,
  p_recurrence_group_id uuid default null,
  p_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  new_id uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_boat_id is null then raise exception 'boatId required'; end if;
  if p_date is null or p_start_time is null or p_end_time is null then
    raise exception 'date, startTime, endTime required';
  end if;
  if p_end_time <= p_start_time then raise exception 'endTime must be after startTime'; end if;

  if p_slot_id is not null then
    select id into existing_id from public.reservation_slots where id = p_slot_id;
  end if;

  if public.slot_has_conflict_(p_boat_id, p_date, p_start_time, p_end_time, existing_id) then
    raise exception 'Slot conflicts with an existing slot on this boat';
  end if;

  if existing_id is not null then
    update public.reservation_slots set
      date = p_date, start_time = p_start_time, end_time = p_end_time, note = coalesce(p_note, '')
    where id = existing_id;
    return jsonb_build_object('saved', true, 'slotId', existing_id);
  end if;

  insert into public.reservation_slots (id, boat_id, date, start_time, end_time, recurrence_group_id, note)
  values (coalesce(p_slot_id, gen_random_uuid()), p_boat_id, p_date, p_start_time, p_end_time, p_recurrence_group_id, coalesce(p_note, ''))
  returning id into new_id;
  return jsonb_build_object('saved', true, 'slotId', new_id);
end;
$$;
revoke execute on function public.save_slot(uuid, date, time, time, uuid, uuid, text) from public, anon;
grant execute on function public.save_slot(uuid, date, time, time, uuid, uuid, text) to authenticated;

create or replace function public.save_recurring_slots(
  p_boat_id uuid,
  p_start_time time,
  p_end_time time,
  p_from_date date,
  p_to_date date,
  p_days_of_week jsonb,
  p_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec_id uuid := gen_random_uuid();
  days int[];
  created uuid[] := '{}';
  skipped int := 0;
  d date;
  new_id uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_boat_id is null then raise exception 'boatId required'; end if;
  if p_start_time is null or p_end_time is null then raise exception 'startTime and endTime required'; end if;
  if p_end_time <= p_start_time then raise exception 'endTime must be after startTime'; end if;
  if p_from_date is null or p_to_date is null then raise exception 'fromDate and toDate required'; end if;
  if p_days_of_week is null or jsonb_array_length(p_days_of_week) = 0 then
    raise exception 'daysOfWeek required (array of 0-6)';
  end if;
  select array(select jsonb_array_elements_text(p_days_of_week)::int) into days;

  d := p_from_date;
  while d <= p_to_date loop
    if extract(dow from d)::int = any(days) then
      if public.slot_has_conflict_(p_boat_id, d, p_start_time, p_end_time, null) then
        skipped := skipped + 1;
      else
        insert into public.reservation_slots (boat_id, date, start_time, end_time, recurrence_group_id, note)
        values (p_boat_id, d, p_start_time, p_end_time, rec_id, coalesce(p_note, ''))
        returning id into new_id;
        created := created || new_id;
      end if;
    end if;
    d := d + 1;
  end loop;

  return jsonb_build_object(
    'saved', true, 'recurrenceGroupId', rec_id, 'count', array_length(created, 1),
    'skipped', skipped, 'slotIds', to_jsonb(created)
  );
end;
$$;
revoke execute on function public.save_recurring_slots(uuid, time, time, date, date, jsonb, text) from public, anon;
grant execute on function public.save_recurring_slots(uuid, time, time, date, date, jsonb, text) to authenticated;

create or replace function public.delete_slot(p_slot_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_slot_id is null then raise exception 'slotId required'; end if;
  delete from public.reservation_slots where id = p_slot_id;
  return jsonb_build_object('deleted', true);
end;
$$;
revoke execute on function public.delete_slot(uuid) from public, anon;
grant execute on function public.delete_slot(uuid) to authenticated;

create or replace function public.delete_recurrence_group(p_recurrence_group_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_recurrence_group_id is null then raise exception 'recurrenceGroupId required'; end if;
  with deleted as (
    delete from public.reservation_slots where recurrence_group_id = p_recurrence_group_id returning 1
  )
  select count(*) into n from deleted;
  return jsonb_build_object('deleted', true, 'count', n);
end;
$$;
revoke execute on function public.delete_recurrence_group(uuid) from public, anon;
grant execute on function public.delete_recurrence_group(uuid) to authenticated;

create or replace function public.book_slot(
  p_slot_id uuid,
  p_kennitala text default '',
  p_member_name text default '',
  p_crew_id uuid default null,
  p_booking_color text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slot public.reservation_slots;
  boat public.boats;
  crew public.crews;
  is_member boolean;
  booked_kt text := '';
  booked_name text := '';
  booked_crew_id uuid := null;
  tentative_flag boolean := false;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_slot_id is null then raise exception 'slotId required'; end if;

  select * into slot from public.reservation_slots where id = p_slot_id;
  if not found then raise exception 'Slot not found'; end if;
  if slot.booked_by_kennitala is not null and slot.booked_by_kennitala <> '' then
    raise exception 'Slot already booked';
  end if;

  select * into boat from public.boats where id = slot.boat_id;
  if not found then raise exception 'Boat not found'; end if;

  if p_crew_id is not null then
    select * into crew from public.crews where id = p_crew_id;
    if not found or crew.status = 'disbanded' then raise exception 'Crew not found or disbanded'; end if;
    if crew.status <> 'active' and crew.status <> 'forming' then raise exception 'Crew not found or not active'; end if;
    is_member := public.crew_pairs_has_member_(crew.pairs, p_kennitala);
    if not is_member then raise exception 'You are not a member of this crew'; end if;
    booked_crew_id := p_crew_id;
    booked_name := coalesce(nullif(crew.name, ''), p_member_name, '');
    booked_kt := coalesce(p_kennitala, '');
    tentative_flag := (crew.status = 'forming');
  else
    if p_kennitala is null or p_kennitala = '' then raise exception 'kennitala required'; end if;
    -- Deliberately stubbed: keelboat cert-access gate — see migration header.
    booked_kt := p_kennitala;
    booked_name := coalesce(p_member_name, '');
  end if;

  update public.reservation_slots set
    booked_by_kennitala = booked_kt, booked_by_name = booked_name, booked_by_crew_id = booked_crew_id,
    booking_color = coalesce(p_booking_color, ''), tentative = tentative_flag
  where id = p_slot_id;

  return jsonb_build_object('booked', true, 'slotId', p_slot_id);
end;
$$;
revoke execute on function public.book_slot(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.book_slot(uuid, text, text, uuid, text) to authenticated;

create or replace function public.unbook_slot(p_slot_id uuid, p_kennitala text default '') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slot public.reservation_slots;
  crew public.crews;
  is_booker boolean;
  is_crew_member boolean := false;
  is_staff boolean := false;
  mem_role text;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_slot_id is null then raise exception 'slotId required'; end if;

  select * into slot from public.reservation_slots where id = p_slot_id;
  if not found then raise exception 'Slot not found'; end if;
  if slot.booked_by_kennitala is null or slot.booked_by_kennitala = '' then
    raise exception 'Slot is not booked';
  end if;

  is_booker := slot.booked_by_kennitala = coalesce(p_kennitala, '');
  if slot.booked_by_crew_id is not null then
    select * into crew from public.crews where id = slot.booked_by_crew_id;
    if found then
      is_crew_member := public.crew_pairs_has_member_(crew.pairs, p_kennitala);
    end if;
  end if;
  if p_kennitala is not null and p_kennitala <> '' then
    select role into mem_role from public.members where kennitala = p_kennitala;
    is_staff := mem_role in ('staff', 'admin');
  end if;
  if not is_booker and not is_crew_member and not is_staff then
    raise exception 'Only the booker, a crew member, or staff can cancel';
  end if;

  if slot.source_activity_class_id is not null then
    delete from public.reservation_slots where id = p_slot_id;
    return jsonb_build_object('unbooked', true, 'dematerialized', true);
  end if;

  update public.reservation_slots set
    booked_by_kennitala = null, booked_by_name = null, booked_by_crew_id = null,
    booking_color = null, tentative = false
  where id = p_slot_id;
  return jsonb_build_object('unbooked', true);
end;
$$;
revoke execute on function public.unbook_slot(uuid, text) from public, anon;
grant execute on function public.unbook_slot(uuid, text) to authenticated;

create or replace function public.bulk_book_slots(
  p_boat_id uuid,
  p_from_date date,
  p_to_date date,
  p_days_of_week jsonb,
  p_kennitala text,
  p_member_name text default '',
  p_crew_id uuid default null,
  p_booking_color text default '',
  p_start_time time default null,
  p_end_time time default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  boat public.boats;
  crew public.crews;
  is_member boolean;
  booked_kt text; booked_name text; booked_crew_id uuid := null; tentative_flag boolean := false;
  days int[];
  sl record;
  booked int := 0;
  skipped int := 0;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_boat_id is null then raise exception 'boatId required'; end if;
  if p_from_date is null or p_to_date is null then raise exception 'fromDate and toDate required'; end if;
  if p_days_of_week is null or jsonb_array_length(p_days_of_week) = 0 then
    raise exception 'daysOfWeek required (array of 0-6)';
  end if;
  if p_kennitala is null or p_kennitala = '' then raise exception 'kennitala required'; end if;
  select array(select jsonb_array_elements_text(p_days_of_week)::int) into days;

  select * into boat from public.boats where id = p_boat_id;
  if not found then raise exception 'Boat not found'; end if;

  if p_crew_id is not null then
    select * into crew from public.crews where id = p_crew_id;
    if not found or crew.status = 'disbanded' then raise exception 'Crew not found or disbanded'; end if;
    if crew.status <> 'active' and crew.status <> 'forming' then raise exception 'Crew not found or not active'; end if;
    is_member := public.crew_pairs_has_member_(crew.pairs, p_kennitala);
    if not is_member then raise exception 'You are not a member of this crew'; end if;
    booked_crew_id := p_crew_id;
    booked_name := coalesce(nullif(crew.name, ''), p_member_name, '');
    booked_kt := p_kennitala;
    tentative_flag := (crew.status = 'forming');
  else
    -- Deliberately stubbed: keelboat cert-access gate — see migration header.
    booked_kt := p_kennitala;
    booked_name := coalesce(p_member_name, '');
  end if;

  for sl in
    select id, start_time, end_time, booked_by_kennitala from public.reservation_slots
    where boat_id = p_boat_id and date >= p_from_date and date <= p_to_date
      and extract(dow from date)::int = any(days)
      and (p_start_time is null or start_time >= p_start_time)
      and (p_end_time is null or end_time <= p_end_time)
  loop
    if sl.booked_by_kennitala is not null and sl.booked_by_kennitala <> '' then
      skipped := skipped + 1;
    else
      update public.reservation_slots set
        booked_by_kennitala = booked_kt, booked_by_name = booked_name, booked_by_crew_id = booked_crew_id,
        booking_color = coalesce(p_booking_color, ''), tentative = tentative_flag
      where id = sl.id;
      booked := booked + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'booked', booked, 'skipped', skipped);
end;
$$;
revoke execute on function public.bulk_book_slots(uuid, date, date, jsonb, text, text, uuid, text, time, time) from public, anon;
grant execute on function public.bulk_book_slots(uuid, date, date, jsonb, text, text, uuid, text, time, time) to authenticated;

-- ═══════════════════════════════════════ CREWS ════════════════════════════════

create or replace function public.create_crew(
  p_name text,
  p_kennitala text,
  p_member_name text,
  p_num_pairs int default 2,
  p_creator_pair_index int default 0,
  p_creator_seat_index int default 0,
  p_visibility text default 'open',
  p_description text default '',
  p_color text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  num_pairs int := coalesce(p_num_pairs, 2);
  creator_pair int := coalesce(p_creator_pair_index, 0);
  creator_seat int := coalesce(p_creator_seat_index, 0);
  visibility text;
  color text;
  palette text[] := array['#e74c3c','#e67e22','#f1c40f','#27ae60','#2980b9','#8e44ad','#d4af37','#a78bfa'];
  existing_count int;
  pairs jsonb := '[]'::jsonb;
  i int;
  new_id uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_name is null or p_name = '' then raise exception 'Crew name required'; end if;
  if p_kennitala is null or p_kennitala = '' or p_member_name is null or p_member_name = '' then
    raise exception 'Creator kennitala and name required';
  end if;
  if num_pairs < 2 or num_pairs > 3 then raise exception 'numPairs must be 2 or 3'; end if;
  if creator_pair >= num_pairs or creator_pair < 0 then creator_pair := 0; end if;
  if creator_seat > 1 or creator_seat < 0 then creator_seat := 0; end if;

  for i in 0 .. num_pairs - 1 loop
    pairs := pairs || jsonb_build_array(jsonb_build_object('pairId', 'pair_' || (i + 1), 'members', jsonb_build_array(null, null)));
  end loop;
  pairs := jsonb_set(pairs, array[creator_pair::text, 'members', creator_seat::text], jsonb_build_object('kennitala', p_kennitala, 'name', p_member_name));

  visibility := case when p_visibility = 'invite_only' then 'invite_only' else 'open' end;

  if p_color ~* '^#[0-9a-f]{6}$' then
    color := p_color;
  else
    select count(*) into existing_count from public.crews where status <> 'disbanded';
    color := palette[(existing_count % 8) + 1];
  end if;

  insert into public.crews (name, pairs, description, visibility, color, status)
  values (p_name, pairs, coalesce(p_description, ''), visibility, color, 'forming')
  returning id into new_id;

  return jsonb_build_object(
    'created', true, 'crewId', new_id,
    'crew', jsonb_build_object('id', new_id, 'name', p_name, 'pairs', pairs, 'status', 'forming',
      'description', coalesce(p_description, ''), 'visibility', visibility, 'color', color)
  );
end;
$$;
revoke execute on function public.create_crew(text, text, text, int, int, int, text, text, text) from public, anon;
grant execute on function public.create_crew(text, text, text, int, int, int, text, text, text) to authenticated;

create or replace function public.update_crew(
  p_crew_id uuid,
  p_name text default null,
  p_description text default null,
  p_visibility text default null,
  p_color text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  crew public.crews;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_crew_id is null then raise exception 'crewId required'; end if;
  select * into crew from public.crews where id = p_crew_id;
  if not found then raise exception 'Crew not found'; end if;
  if crew.status = 'disbanded' then raise exception 'Crew is disbanded'; end if;

  update public.crews set
    name = coalesce(p_name, name),
    description = coalesce(p_description, description),
    visibility = case when p_visibility is not null then (case when p_visibility = 'invite_only' then 'invite_only' else 'open' end) else visibility end,
    color = coalesce(p_color, color),
    updated_at = now()
  where id = p_crew_id;

  return jsonb_build_object('updated', true);
end;
$$;
revoke execute on function public.update_crew(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_crew(uuid, text, text, text, text) to authenticated;

create or replace function public.disband_crew(p_crew_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  crew public.crews;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_crew_id is null then raise exception 'crewId required'; end if;
  select * into crew from public.crews where id = p_crew_id;
  if not found then raise exception 'Crew not found'; end if;

  update public.crews set status = 'disbanded', updated_at = now() where id = p_crew_id;
  update public.crew_invites set status = 'rejected', responded_at = now()
    where crew_id = p_crew_id and status = 'pending';

  return jsonb_build_object('disbanded', true);
end;
$$;
revoke execute on function public.disband_crew(uuid) from public, anon;
grant execute on function public.disband_crew(uuid) to authenticated;

create or replace function public.join_crew(
  p_crew_id uuid, p_kennitala text, p_member_name text, p_pair_id text, p_seat_index int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  crew public.crews;
  v_pairs jsonb;
  pair_idx int;
  seat jsonb;
  total_members int;
  total_slots int;
  new_status text;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_crew_id is null then raise exception 'crewId required'; end if;
  if p_kennitala is null or p_kennitala = '' or p_member_name is null or p_member_name = '' then
    raise exception 'kennitala and memberName required';
  end if;
  if p_pair_id is null or p_pair_id = '' then raise exception 'pairId required'; end if;
  if p_seat_index is null or p_seat_index < 0 or p_seat_index > 1 then
    raise exception 'seatIndex must be 0 (bow) or 1 (stern)';
  end if;

  select * into crew from public.crews where id = p_crew_id;
  if not found then raise exception 'Crew not found'; end if;
  if crew.status = 'disbanded' then raise exception 'Crew is disbanded'; end if;
  if coalesce(crew.visibility, 'open') = 'invite_only' then raise exception 'This crew is invite-only'; end if;

  v_pairs := crew.pairs;
  if public.crew_pairs_has_member_(v_pairs, p_kennitala) then raise exception 'You are already in this crew'; end if;

  pair_idx := public.crew_find_pair_index_(v_pairs, p_pair_id);
  if pair_idx is null then raise exception 'Pair not found'; end if;

  seat := v_pairs #> array[pair_idx::text, 'members', p_seat_index::text];
  if seat is not null and seat <> 'null'::jsonb then raise exception 'This seat is taken'; end if;

  v_pairs := jsonb_set(v_pairs, array[pair_idx::text, 'members', p_seat_index::text], jsonb_build_object('kennitala', p_kennitala, 'name', p_member_name));

  total_members := public.crew_total_members_(v_pairs);
  total_slots := jsonb_array_length(v_pairs) * 2;
  new_status := case when total_members >= total_slots then 'active' else 'forming' end;

  update public.crews set pairs = v_pairs, status = new_status, updated_at = now() where id = p_crew_id;
  return jsonb_build_object('joined', true, 'status', new_status);
end;
$$;
revoke execute on function public.join_crew(uuid, text, text, text, int) from public, anon;
grant execute on function public.join_crew(uuid, text, text, text, int) to authenticated;

create or replace function public.leave_crew(p_crew_id uuid, p_kennitala text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  crew public.crews;
  v_pairs jsonb;
  n_pairs int;
  i int; j int;
  seat jsonb;
  found_flag boolean := false;
  total_members int;
  new_status text;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_crew_id is null then raise exception 'crewId required'; end if;
  if p_kennitala is null or p_kennitala = '' then raise exception 'kennitala required'; end if;

  select * into crew from public.crews where id = p_crew_id;
  if not found then raise exception 'Crew not found'; end if;
  if crew.status = 'disbanded' then raise exception 'Crew is disbanded'; end if;

  v_pairs := crew.pairs;
  n_pairs := coalesce(jsonb_array_length(v_pairs), 0);
  for i in 0 .. n_pairs - 1 loop
    for j in 0 .. 1 loop
      seat := v_pairs #> array[i::text, 'members', j::text];
      if seat is not null and seat <> 'null'::jsonb and (seat->>'kennitala') = p_kennitala then
        v_pairs := jsonb_set(v_pairs, array[i::text, 'members', j::text], 'null'::jsonb);
        found_flag := true;
      end if;
    end loop;
  end loop;
  if not found_flag then raise exception 'You are not in this crew'; end if;

  total_members := public.crew_total_members_(v_pairs);
  if total_members = 0 then
    update public.crews set status = 'disbanded', updated_at = now() where id = p_crew_id;
    return jsonb_build_object('left', true, 'disbanded', true);
  end if;

  new_status := case when total_members >= n_pairs * 2 then 'active' else 'forming' end;
  update public.crews set pairs = v_pairs, status = new_status, updated_at = now() where id = p_crew_id;
  return jsonb_build_object('left', true, 'status', new_status);
end;
$$;
revoke execute on function public.leave_crew(uuid, text) from public, anon;
grant execute on function public.leave_crew(uuid, text) to authenticated;

create or replace function public.invite_to_crew(
  p_crew_id uuid, p_to_kennitala text, p_to_name text, p_from_kennitala text, p_from_name text, p_pair_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  crew public.crews;
  pairs jsonb;
  pair_idx int;
  members jsonb;
  open_seats int;
  existing_id uuid;
  from_id uuid;
  to_id uuid;
  new_id uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_crew_id is null then raise exception 'crewId required'; end if;
  if p_to_kennitala is null or p_to_kennitala = '' or p_to_name is null or p_to_name = '' then
    raise exception 'Invitee kennitala and name required';
  end if;
  if p_from_kennitala is null or p_from_kennitala = '' or p_from_name is null or p_from_name = '' then
    raise exception 'Inviter kennitala and name required';
  end if;
  if p_pair_id is null or p_pair_id = '' then raise exception 'pairId required'; end if;

  select * into crew from public.crews where id = p_crew_id;
  if not found then raise exception 'Crew not found'; end if;
  if crew.status = 'disbanded' then raise exception 'Crew is disbanded'; end if;

  pairs := crew.pairs;
  pair_idx := public.crew_find_pair_index_(pairs, p_pair_id);
  if pair_idx is null then raise exception 'Pair not found'; end if;

  members := pairs #> array[pair_idx::text, 'members'];
  open_seats := (
    select count(*) from jsonb_array_elements(coalesce(members, '[]'::jsonb)) m where m = 'null'::jsonb
  );
  if open_seats = 0 then raise exception 'This pair is full'; end if;
  if public.crew_pairs_has_member_(pairs, p_to_kennitala) then raise exception 'This person is already in the crew'; end if;

  select id into existing_id from public.crew_invites
    where crew_id = p_crew_id and to_kennitala = p_to_kennitala and status = 'pending';
  if existing_id is not null then raise exception 'An invite is already pending for this person'; end if;

  select id into from_id from public.members where kennitala = p_from_kennitala;
  select id into to_id from public.members where kennitala = p_to_kennitala;

  insert into public.crew_invites (
    crew_id, crew_name, pair_id, from_member_id, from_kennitala, from_name, to_member_id, to_kennitala, to_name, status
  ) values (
    p_crew_id, crew.name, p_pair_id, from_id, p_from_kennitala, p_from_name, to_id, p_to_kennitala, p_to_name, 'pending'
  ) returning id into new_id;

  return jsonb_build_object('invited', true, 'inviteId', new_id);
end;
$$;
revoke execute on function public.invite_to_crew(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.invite_to_crew(uuid, text, text, text, text, text) to authenticated;

create or replace function public.respond_crew_invite(
  p_invite_id uuid, p_response text, p_seat_index int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.crew_invites;
  crew public.crews;
  v_pairs jsonb;
  pair_idx int;
  seat_idx int;
  s0 jsonb; s1 jsonb;
  total_members int;
  total_slots int;
  new_status text;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_invite_id is null then raise exception 'inviteId required'; end if;
  if p_response is null or p_response not in ('accepted', 'rejected') then
    raise exception 'response must be accepted or rejected';
  end if;

  select * into inv from public.crew_invites where id = p_invite_id;
  if not found then raise exception 'Invite not found'; end if;
  if inv.status <> 'pending' then raise exception 'Invite already responded to'; end if;

  update public.crew_invites set status = p_response, responded_at = now() where id = p_invite_id;

  if p_response = 'accepted' and inv.crew_id is not null then
    select * into crew from public.crews where id = inv.crew_id;
    if found then
      v_pairs := crew.pairs;
      pair_idx := public.crew_find_pair_index_(v_pairs, inv.pair_id);
      if pair_idx is not null then
        s0 := v_pairs #> array[pair_idx::text, 'members', '0'];
        s1 := v_pairs #> array[pair_idx::text, 'members', '1'];
        seat_idx := p_seat_index;
        if seat_idx is null or seat_idx < 0 or seat_idx > 1
           or (v_pairs #> array[pair_idx::text, 'members', seat_idx::text]) <> 'null'::jsonb then
          if s0 is null or s0 = 'null'::jsonb then seat_idx := 0;
          elsif s1 is null or s1 = 'null'::jsonb then seat_idx := 1;
          else seat_idx := -1;
          end if;
        end if;
        if seat_idx >= 0 then
          v_pairs := jsonb_set(v_pairs, array[pair_idx::text, 'members', seat_idx::text], jsonb_build_object('kennitala', inv.to_kennitala, 'name', inv.to_name));
          total_members := public.crew_total_members_(v_pairs);
          total_slots := jsonb_array_length(v_pairs) * 2;
          new_status := case when total_members >= total_slots then 'active' else 'forming' end;
          update public.crews set pairs = v_pairs, status = new_status, updated_at = now() where id = inv.crew_id;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('responded', true, 'status', p_response);
end;
$$;
revoke execute on function public.respond_crew_invite(uuid, text, int) from public, anon;
grant execute on function public.respond_crew_invite(uuid, text, int) to authenticated;

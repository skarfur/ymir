-- Phase 3, trips.gs's write actions: saveTrip_ (generic sparse insert-
-- or-patch), setHelm_, deleteTrip_. None were in ADMIN_ACTIONS_/
-- STAFF_ACTIONS_ — session-only, matching the original.
--
-- saveTrip_ is inherently a sparse-PATCH API: ~15 real call sites across
-- member/staff/shared/logbook-*.js each send a different subset of
-- fields (one even patches a single dynamic field name — see
-- shared/logbook-confirm.js's `{ id: tripId, [field]: val }`). A fixed
-- parameter list with NULL-as-"not provided" can't safely represent this
-- (several fields — verifiedAt, wxSnapshot, trackSimplified, photoMeta —
-- can be legitimately set to an actual null). So save_trip takes the
-- whole sparse update as one jsonb blob and uses the `?` (has-key)
-- operator per field, exactly mirroring the original's
-- `if (b[k] !== undefined) updates[k] = b[k]` / the already-deployed
-- save-trip Edge Function's translateFields().

create or replace function public.trip_parse_json_maybe_(v jsonb) returns jsonb
language plpgsql
as $$
declare
  txt text;
begin
  if v is null or v = 'null'::jsonb then return null; end if;
  if jsonb_typeof(v) = 'string' then
    txt := v #>> '{}';
    if txt = '' then return null; end if;
    begin
      return txt::jsonb;
    exception when others then return null;
    end;
  end if;
  return v;
end;
$$;
revoke execute on function public.trip_parse_json_maybe_(jsonb) from public, anon, authenticated;

create or replace function public.trip_parse_arr_maybe_(v jsonb) returns jsonb
language plpgsql
as $$
declare
  txt text;
  parsed jsonb;
begin
  if v is null then return '[]'::jsonb; end if;
  if jsonb_typeof(v) = 'array' then return v; end if;
  if jsonb_typeof(v) = 'string' then
    txt := v #>> '{}';
    if txt = '' then return '[]'::jsonb; end if;
    begin
      parsed := txt::jsonb;
      if jsonb_typeof(parsed) = 'array' then return parsed; end if;
      return '[]'::jsonb;
    exception when others then return '[]'::jsonb;
    end;
  end if;
  return '[]'::jsonb;
end;
$$;
revoke execute on function public.trip_parse_arr_maybe_(jsonb) from public, anon, authenticated;

create or replace function public.save_trip(p_id uuid default null, p_updates jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.trips;
  is_insert boolean;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  bid text; lid text; lcid text; ltid text;
  boat_cat text;
  v_member_kennitala text; v_member_id uuid; v_member_name text;
  v_date date; v_time_out timestamptz; v_time_in timestamptz; v_hours_decimal numeric;
  v_boat_id uuid; v_boat_name text; v_boat_category text;
  v_location_id uuid; v_location_name text;
  v_crew_count int; v_role text; v_beaufort int; v_wind_dir text; v_wx_snapshot jsonb;
  v_notes text; v_is_linked boolean; v_linked_checkout_id uuid; v_linked_trip_id uuid;
  v_verified boolean; v_verified_by text; v_verified_at timestamptz; v_staff_comment text;
  v_validation_requested boolean; v_helm text; v_student text; v_skipper_note text;
  v_distance_nm numeric; v_departure_port text; v_arrival_port text; v_non_club boolean;
  v_track_file_url text; v_track_simplified jsonb; v_track_source text;
  v_photo_urls text[]; v_photo_meta jsonb; v_crew jsonb;
  new_id uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  p_updates := coalesce(p_updates, '{}'::jsonb);

  if p_id is not null then
    select * into existing from public.trips where id = p_id;
  end if;
  is_insert := existing.id is null;

  if not is_insert then
    v_member_kennitala := existing.member_kennitala; v_member_id := existing.member_id; v_member_name := existing.member_name;
    v_date := existing.date; v_time_out := existing.time_out; v_time_in := existing.time_in; v_hours_decimal := existing.hours_decimal;
    v_boat_id := existing.boat_id; v_boat_name := existing.boat_name; v_boat_category := existing.boat_category;
    v_location_id := existing.location_id; v_location_name := existing.location_name;
    v_crew_count := existing.crew_count; v_role := existing.role; v_beaufort := existing.beaufort; v_wind_dir := existing.wind_dir;
    v_wx_snapshot := existing.wx_snapshot; v_notes := existing.notes; v_is_linked := existing.is_linked;
    v_linked_checkout_id := existing.linked_checkout_id; v_linked_trip_id := existing.linked_trip_id;
    v_verified := existing.verified; v_verified_by := existing.verified_by; v_verified_at := existing.verified_at;
    v_staff_comment := existing.staff_comment; v_validation_requested := existing.validation_requested;
    v_helm := existing.helm; v_student := existing.student; v_skipper_note := existing.skipper_note;
    v_distance_nm := existing.distance_nm; v_departure_port := existing.departure_port; v_arrival_port := existing.arrival_port;
    v_non_club := existing.non_club; v_track_file_url := existing.track_file_url; v_track_simplified := existing.track_simplified;
    v_track_source := existing.track_source; v_photo_urls := existing.photo_urls; v_photo_meta := existing.photo_meta; v_crew := existing.crew;
  else
    v_date := coalesce(nullif(p_updates->>'date', '')::date, current_date);
    v_role := 'skipper'; v_crew_count := 1; v_verified := false;
    v_member_kennitala := ''; v_member_name := ''; v_hours_decimal := 0;
    v_boat_name := ''; v_boat_category := ''; v_location_name := '';
    v_wind_dir := ''; v_notes := ''; v_is_linked := false;
    v_verified_by := ''; v_staff_comment := ''; v_validation_requested := false;
    v_helm := ''; v_student := ''; v_skipper_note := '';
    v_departure_port := ''; v_arrival_port := ''; v_non_club := false;
    v_track_file_url := ''; v_track_source := ''; v_photo_urls := array[]::text[];
    v_crew := '[]'::jsonb;
  end if;

  if p_updates ? 'kennitala' then
    v_member_kennitala := coalesce(p_updates->>'kennitala', '');
    v_member_id := null;
    if v_member_kennitala <> '' then
      select id into v_member_id from public.members where kennitala = v_member_kennitala;
    end if;
  end if;
  if p_updates ? 'memberName' then v_member_name := coalesce(p_updates->>'memberName', ''); end if;
  if p_updates ? 'date' then v_date := coalesce(nullif(p_updates->>'date', '')::date, v_date); end if;
  if p_updates ? 'timeOut' then v_time_out := public.checkouts_time_to_ts_(p_updates->>'timeOut', v_date); end if;
  if p_updates ? 'timeIn' then v_time_in := public.checkouts_time_to_ts_(p_updates->>'timeIn', v_date); end if;
  if p_updates ? 'hoursDecimal' then
    v_hours_decimal := case when coalesce(p_updates->>'hoursDecimal', '') = '' then null else (p_updates->>'hoursDecimal')::numeric end;
  end if;
  if p_updates ? 'boatId' then
    v_boat_id := null; boat_cat := null;
    bid := coalesce(p_updates->>'boatId', '');
    if bid <> '' and bid ~* uuid_re then
      select id, category into v_boat_id, boat_cat from public.boats where id = bid::uuid;
      if is_insert and not (p_updates ? 'boatCategory') and boat_cat is not null then
        v_boat_category := boat_cat;
      end if;
    end if;
  end if;
  if p_updates ? 'boatName' then v_boat_name := coalesce(p_updates->>'boatName', ''); end if;
  if p_updates ? 'boatCategory' then v_boat_category := coalesce(p_updates->>'boatCategory', ''); end if;
  if p_updates ? 'locationId' then
    v_location_id := null;
    lid := coalesce(p_updates->>'locationId', '');
    if lid <> '' and lid ~* uuid_re then
      select id into v_location_id from public.locations where id = lid::uuid;
    end if;
  end if;
  if p_updates ? 'locationName' then v_location_name := coalesce(p_updates->>'locationName', ''); end if;
  if p_updates ? 'crew' then v_crew_count := coalesce(nullif(p_updates->>'crew', '')::int, 1); end if;
  if p_updates ? 'role' then v_role := coalesce(nullif(p_updates->>'role', ''), 'skipper'); end if;
  if p_updates ? 'beaufort' then
    v_beaufort := case when coalesce(p_updates->>'beaufort', '') = '' then null else (p_updates->>'beaufort')::int end;
  end if;
  if p_updates ? 'windDir' then v_wind_dir := coalesce(p_updates->>'windDir', ''); end if;
  if p_updates ? 'wxSnapshot' then v_wx_snapshot := public.trip_parse_json_maybe_(p_updates->'wxSnapshot'); end if;
  if p_updates ? 'notes' then v_notes := coalesce(p_updates->>'notes', ''); end if;
  if p_updates ? 'isLinked' then v_is_linked := coalesce((p_updates->>'isLinked')::boolean, false); end if;
  if p_updates ? 'linkedCheckoutId' then
    v_linked_checkout_id := null;
    lcid := coalesce(p_updates->>'linkedCheckoutId', '');
    if lcid <> '' and lcid ~* uuid_re then v_linked_checkout_id := lcid::uuid; end if;
  end if;
  if p_updates ? 'linkedTripId' then
    v_linked_trip_id := null;
    ltid := coalesce(p_updates->>'linkedTripId', '');
    if ltid <> '' and ltid ~* uuid_re then v_linked_trip_id := ltid::uuid; end if;
  end if;
  if p_updates ? 'verified' then v_verified := coalesce((p_updates->>'verified')::boolean, false); end if;
  if p_updates ? 'verifiedBy' then v_verified_by := coalesce(p_updates->>'verifiedBy', ''); end if;
  if p_updates ? 'verifiedAt' then v_verified_at := nullif(p_updates->>'verifiedAt', '')::timestamptz; end if;
  if p_updates ? 'staffComment' then v_staff_comment := coalesce(p_updates->>'staffComment', ''); end if;
  if p_updates ? 'validationRequested' then v_validation_requested := coalesce((p_updates->>'validationRequested')::boolean, false); end if;
  if p_updates ? 'helm' then v_helm := coalesce(p_updates->>'helm', ''); end if;
  if p_updates ? 'student' then v_student := coalesce(p_updates->>'student', ''); end if;
  if p_updates ? 'skipperNote' then v_skipper_note := coalesce(p_updates->>'skipperNote', ''); end if;
  if p_updates ? 'distanceNm' then
    v_distance_nm := case when coalesce(p_updates->>'distanceNm', '') = '' then null else (p_updates->>'distanceNm')::numeric end;
  end if;
  if p_updates ? 'departurePort' then v_departure_port := coalesce(p_updates->>'departurePort', ''); end if;
  if p_updates ? 'arrivalPort' then v_arrival_port := coalesce(p_updates->>'arrivalPort', ''); end if;
  if p_updates ? 'nonClub' then v_non_club := coalesce((p_updates->>'nonClub')::boolean, false); end if;
  if p_updates ? 'trackFileUrl' then v_track_file_url := coalesce(p_updates->>'trackFileUrl', ''); end if;
  if p_updates ? 'trackSimplified' then v_track_simplified := public.trip_parse_json_maybe_(p_updates->'trackSimplified'); end if;
  if p_updates ? 'trackSource' then v_track_source := coalesce(p_updates->>'trackSource', ''); end if;
  if p_updates ? 'photoUrls' then
    v_photo_urls := array(select jsonb_array_elements_text(public.trip_parse_arr_maybe_(p_updates->'photoUrls')));
  end if;
  if p_updates ? 'photoMeta' then v_photo_meta := public.trip_parse_json_maybe_(p_updates->'photoMeta'); end if;
  if p_updates ? 'crewNames' then v_crew := public.trip_parse_arr_maybe_(p_updates->'crewNames'); end if;

  if not is_insert then
    update public.trips set
      member_kennitala = v_member_kennitala, member_id = v_member_id, member_name = v_member_name,
      date = v_date, time_out = v_time_out, time_in = v_time_in, hours_decimal = v_hours_decimal,
      boat_id = v_boat_id, boat_name = v_boat_name, boat_category = v_boat_category,
      location_id = v_location_id, location_name = v_location_name,
      crew_count = v_crew_count, role = v_role, beaufort = v_beaufort, wind_dir = v_wind_dir,
      wx_snapshot = v_wx_snapshot, notes = v_notes, is_linked = v_is_linked,
      linked_checkout_id = v_linked_checkout_id, linked_trip_id = v_linked_trip_id,
      verified = v_verified, verified_by = v_verified_by, verified_at = v_verified_at,
      staff_comment = v_staff_comment, validation_requested = v_validation_requested,
      helm = v_helm, student = v_student, skipper_note = v_skipper_note,
      distance_nm = v_distance_nm, departure_port = v_departure_port, arrival_port = v_arrival_port,
      non_club = v_non_club, track_file_url = v_track_file_url, track_simplified = v_track_simplified,
      track_source = v_track_source, photo_urls = v_photo_urls, photo_meta = v_photo_meta, crew = v_crew,
      actor_id = public.current_member_id(), updated_at = now()
    where id = p_id;
    return jsonb_build_object('id', p_id, 'updated', true);
  else
    insert into public.trips (
      member_kennitala, member_id, member_name, date, time_out, time_in, hours_decimal,
      boat_id, boat_name, boat_category, location_id, location_name,
      crew_count, role, beaufort, wind_dir, wx_snapshot, notes, is_linked,
      linked_checkout_id, linked_trip_id, verified, verified_by, verified_at,
      staff_comment, validation_requested, helm, student, skipper_note,
      distance_nm, departure_port, arrival_port, non_club, track_file_url,
      track_simplified, track_source, photo_urls, photo_meta, crew, actor_id
    ) values (
      v_member_kennitala, v_member_id, v_member_name, v_date, v_time_out, v_time_in, v_hours_decimal,
      v_boat_id, v_boat_name, v_boat_category, v_location_id, v_location_name,
      v_crew_count, v_role, v_beaufort, v_wind_dir, v_wx_snapshot, v_notes, v_is_linked,
      v_linked_checkout_id, v_linked_trip_id, v_verified, v_verified_by, v_verified_at,
      v_staff_comment, v_validation_requested, v_helm, v_student, v_skipper_note,
      v_distance_nm, v_departure_port, v_arrival_port, v_non_club, v_track_file_url,
      v_track_simplified, v_track_source, v_photo_urls, v_photo_meta, v_crew, public.current_member_id()
    ) returning id into new_id;
    return jsonb_build_object('id', new_id, 'created', true);
  end if;
end;
$$;
revoke execute on function public.save_trip(uuid, jsonb) from public, anon;
grant execute on function public.save_trip(uuid, jsonb) to authenticated;

create or replace function public.set_helm(p_trip_id uuid, p_helm boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_trip_id is null then raise exception 'tripId required'; end if;
  update public.trips set helm = (coalesce(p_helm, false))::text, updated_at = now(), actor_id = public.current_member_id()
  where id = p_trip_id;
  return jsonb_build_object('updated', true);
end;
$$;
revoke execute on function public.set_helm(uuid, boolean) from public, anon;
grant execute on function public.set_helm(uuid, boolean) to authenticated;

create or replace function public.delete_trip(p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_id is null then raise exception 'id required'; end if;
  delete from public.trips where id = p_id returning id into deleted_id;
  return jsonb_build_object('deleted', deleted_id is not null);
end;
$$;
revoke execute on function public.delete_trip(uuid) from public, anon;
grant execute on function public.delete_trip(uuid) to authenticated;

-- Ports checkouts.gs's saveBoat_-equivalent admin write (actually still
-- admin/boats.js's saveBoat()/deleteBoat(), which POST the whole boats
-- array through the generic saveConfig action) and admin/locations.js's
-- saveLocation()/deleteLocation() (same pattern) to real Postgres RPCs.
--
-- This was a genuine gap, not a deferred/deliberate one: the
-- boats_access_control_and_reservations migration already moved boats off
-- the app_config JSON blob onto a real table with real columns (see that
-- migration's header), but the admin frontend was never updated to match
-- — it still reads/writes the whole-array blob via saveConfig, which is
-- Apps-Script-only and has been a dead action since loginMember moved to
-- Supabase. Same story for locations, which never even got a real schema
-- beyond (id, name) until now.
--
-- locations gains type/coordinates/active — admin/locations.js's
-- saveLocation() already sends these fields (type: 'location'|'port',
-- coordinates: "lat,lng" string, active), they just had nowhere to land.
alter table locations add column type text not null default 'location' check (type in ('location', 'port'));
alter table locations add column coordinates text not null default '';
alter table locations add column active boolean not null default true;

create or replace function public.save_location(
  p_id uuid default null,
  p_name text default '',
  p_type text default 'location',
  p_coordinates text default '',
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'saveLocation failed: name required';
  end if;

  if p_id is not null then
    update public.locations set
      name = p_name, type = coalesce(nullif(p_type, ''), 'location'),
      coordinates = coalesce(p_coordinates, ''), active = p_active
    where id = p_id
    returning id into row_id;
    if row_id is null then
      raise exception 'Location not found';
    end if;
  else
    insert into public.locations (name, type, coordinates, active)
      values (p_name, coalesce(nullif(p_type, ''), 'location'), coalesce(p_coordinates, ''), p_active)
      returning id into row_id;
  end if;

  return jsonb_build_object('id', row_id);
end;
$$;
revoke execute on function public.save_location(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.save_location(uuid, text, text, text, boolean) to authenticated;

-- Soft delete, matching admin/locations.js's deleteLocation() exactly
-- (sets active:false, never removes the row) — boats.default_port_id
-- references locations(id), so a hard delete would need a cascade
-- decision the original never made either.
create or replace function public.delete_location(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  update public.locations set active = false where id = p_id;
  return jsonb_build_object('deleted', true);
end;
$$;
revoke execute on function public.delete_location(uuid) from public, anon;
grant execute on function public.delete_location(uuid) to authenticated;

-- save_boat covers every field admin/boats.js's saveBoat() currently
-- assembles into its (dead) saveConfig payload. reservations stay out of
-- scope — save_reservation/remove_reservation already own that table.
create or replace function public.save_boat(
  p_id uuid default null,
  p_name text default '',
  p_category text default '',
  p_active boolean default true,
  p_oos boolean default false,
  p_oos_reason text default '',
  p_default_port_id uuid default null,
  p_registration_no text default '',
  p_type_model text default '',
  p_loa numeric default null,
  p_ownership text default 'club',
  p_owner_kennitala text default '',
  p_owner_name text default '',
  p_access_mode text default 'free',
  p_access_gate jsonb default null,
  p_access_gate_cert text default '',
  p_access_allowlist jsonb default '[]'::jsonb,
  p_slot_scheduling_enabled boolean default false,
  p_available_outside_slots boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'saveBoat failed: name required';
  end if;

  if p_id is not null then
    update public.boats set
      name = p_name, category = p_category, active = p_active,
      oos = p_oos, oos_reason = coalesce(p_oos_reason, ''),
      default_port_id = p_default_port_id,
      registration_no = coalesce(p_registration_no, ''),
      type_model = coalesce(p_type_model, ''),
      loa = p_loa,
      ownership = coalesce(nullif(p_ownership, ''), 'club'),
      owner_kennitala = coalesce(p_owner_kennitala, ''),
      owner_name = coalesce(p_owner_name, ''),
      access_mode = coalesce(nullif(p_access_mode, ''), 'free'),
      access_gate = p_access_gate,
      access_gate_cert = coalesce(p_access_gate_cert, ''),
      access_allowlist = coalesce(p_access_allowlist, '[]'::jsonb),
      slot_scheduling_enabled = p_slot_scheduling_enabled,
      available_outside_slots = p_available_outside_slots
    where id = p_id
    returning id into row_id;
    if row_id is null then
      raise exception 'Boat not found';
    end if;
  else
    insert into public.boats (
      name, category, active, oos, oos_reason, default_port_id, registration_no, type_model, loa,
      ownership, owner_kennitala, owner_name, access_mode, access_gate, access_gate_cert,
      access_allowlist, slot_scheduling_enabled, available_outside_slots
    ) values (
      p_name, p_category, p_active, p_oos, coalesce(p_oos_reason, ''), p_default_port_id,
      coalesce(p_registration_no, ''), coalesce(p_type_model, ''), p_loa,
      coalesce(nullif(p_ownership, ''), 'club'), coalesce(p_owner_kennitala, ''), coalesce(p_owner_name, ''),
      coalesce(nullif(p_access_mode, ''), 'free'), p_access_gate, coalesce(p_access_gate_cert, ''),
      coalesce(p_access_allowlist, '[]'::jsonb), p_slot_scheduling_enabled, p_available_outside_slots
    ) returning id into row_id;
  end if;

  return jsonb_build_object('id', row_id);
end;
$$;
revoke execute on function public.save_boat(
  uuid, text, text, boolean, boolean, text, uuid, text, text, numeric, text, text, text, text, jsonb, text, jsonb, boolean, boolean
) from public, anon;
grant execute on function public.save_boat(
  uuid, text, text, boolean, boolean, text, uuid, text, text, numeric, text, text, text, text, jsonb, text, jsonb, boolean, boolean
) to authenticated;

-- Soft delete, matching admin/boats.js's deleteBoat() exactly (sets
-- active:false — checkouts/trips/reservations reference boat_id, so a
-- hard delete was never the original behavior either).
create or replace function public.delete_boat(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  update public.boats set active = false where id = p_id;
  return jsonb_build_object('deleted', true);
end;
$$;
revoke execute on function public.delete_boat(uuid) from public, anon;
grant execute on function public.delete_boat(uuid) to authenticated;

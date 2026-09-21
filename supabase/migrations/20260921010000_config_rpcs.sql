-- Phase 2 (Domain 5, part 3): the actively-used slice of saveConfig_,
-- plus certs, the daily checklist, staff status, and the flag override.
--
-- app_config is a flat key/value store (see admin_and_payroll_tables.sql)
-- mirroring config.gs's config sheet exactly — same key names get-config
-- already reads (CONFIG_KEYS in supabase/functions/get-config/index.ts).
--
-- Scope note: saveConfig_ also has branches for `boats`/`locations`, but
-- those moved to their own real tables (boats, locations) when get-config
-- was ported — nothing currently writes to those tables at all, so every
-- frontend flow that still does apiPost('saveConfig', {boats:...}) or
-- {locations:...} (captain/staff/maintenance OOS toggles, admin boat and
-- location CRUD) is presently a no-op against the Supabase-backed read
-- path. That's a real, currently-live gap — but it's "port boats/
-- locations CRUD to their own tables", a full domain of its own, not a
-- few more config keys. Deliberately out of scope here; flagged
-- separately. activity_templates (saveActivityType_/deleteActivityType_)
-- is also deferred — it calls Google Calendar and cascade-deletes linked
-- volunteer events, which needs a real Edge-Function-vs-RPC split rather
-- than a plain config-list conversion.

-- Whole-value replace, admin only. Covers every saveConfig_ field that
-- actually has a live caller today (flagConfig, launchChecklists,
-- boatCategories, allowBreaks) plus saveCertCategories_ and
-- saveClubCalendars_, which are the same "client resends the full value"
-- shape under a different action name. Keys are whitelisted rather than
-- accepting anything — an admin already has full config access, so this
-- isn't a privilege boundary, just a deliberate contract instead of a
-- raw arbitrary-key-value endpoint.
create or replace function public.save_config_value(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_key not in ('flagConfig', 'launchChecklists', 'boatCategories', 'certCategories', 'allowBreaks', 'clubCalendars') then
    raise exception 'Unsupported config key: %', p_key;
  end if;
  insert into public.app_config (key, value, updated_at) values (p_key, p_value, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('saved', true);
end;
$$;
revoke execute on function public.save_config_value(text, jsonb) from public, anon;
grant execute on function public.save_config_value(text, jsonb) to authenticated;

-- Charter calendars (rowing/keelboat GCal sync toggles) are 4 separate
-- app_config scalars the admin form always saves together — one RPC call
-- rather than 4 separate save_config_value round trips.
create or replace function public.save_charter_calendars(
  p_rowing_calendar_id text default '',
  p_rowing_calendar_sync_active boolean default false,
  p_keelboat_calendar_id text default '',
  p_keelboat_calendar_sync_active boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  insert into public.app_config (key, value, updated_at) values
    ('rowingCalendarId', to_jsonb(coalesce(p_rowing_calendar_id, '')), now()),
    ('rowingCalendarSyncActive', to_jsonb(coalesce(p_rowing_calendar_sync_active, false)), now()),
    ('keelboatCalendarId', to_jsonb(coalesce(p_keelboat_calendar_id, '')), now()),
    ('keelboatCalendarSyncActive', to_jsonb(coalesce(p_keelboat_calendar_sync_active, false)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('saved', true);
end;
$$;
revoke execute on function public.save_charter_calendars(text, boolean, text, boolean) from public, anon;
grant execute on function public.save_charter_calendars(text, boolean, text, boolean) to authenticated;

-- Staff-accessible (not admin-only) — saveFlagOverride_'s own comment
-- explains why: the on-duty flag override is a staff control, split out
-- from admin-only saveConfig_ specifically so staff can save it.
create or replace function public.save_flag_override(p_flag_override jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  val jsonb;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;
  -- Null or {active:false} clears the override, same as the original's
  -- setConfigSheetValue_('flagOverride', '').
  if p_flag_override is null or coalesce((p_flag_override->>'active')::boolean, false) is not true then
    val := '{}'::jsonb;
  else
    val := p_flag_override;
  end if;
  insert into public.app_config (key, value, updated_at) values ('flagOverride', val, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('saved', jsonb_build_object('flagOverride', true));
end;
$$;
revoke execute on function public.save_flag_override(jsonb) from public, anon;
grant execute on function public.save_flag_override(jsonb) to authenticated;

-- Staff-accessible on-duty / support-boat toggle.
create or replace function public.save_staff_status(p_staff_status jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;
  insert into public.app_config (key, value, updated_at) values ('staffStatus', p_staff_status, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('saved', jsonb_build_object('staffStatus', true));
end;
$$;
revoke execute on function public.save_staff_status(jsonb) from public, anon;
grant execute on function public.save_staff_status(jsonb) to authenticated;

-- Generic admin-only item upsert/delete for the one remaining item-shaped
-- config list in scope, certDefs (saveCertDef_/deleteCertDef_). The
-- client already builds the fully bilingual-normalized item (see
-- admin/certs.js's saveCertDef) — same trust level the original backend
-- extended (no server-side validation beyond "does this id exist").
create or replace function public.save_config_list_item(p_key text, p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  arr jsonb;
  item_id text := nullif(p_item->>'id', '');
  found_idx int := null;
  i int;
  created boolean;
  final_item jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_key not in ('certDefs') then
    raise exception 'Unsupported config key: %', p_key;
  end if;

  select coalesce(value, '[]'::jsonb) into arr from public.app_config where key = p_key;
  if arr is null then arr := '[]'::jsonb; end if;

  if item_id is not null then
    for i in 0 .. jsonb_array_length(arr) - 1 loop
      if arr->i->>'id' = item_id then found_idx := i; end if;
    end loop;
  else
    item_id := p_key || '_' || encode(extensions.gen_random_bytes(8), 'hex');
  end if;

  final_item := p_item || jsonb_build_object('id', item_id);
  if found_idx is not null then
    arr := jsonb_set(arr, array[found_idx::text], final_item);
    created := false;
  else
    arr := arr || jsonb_build_array(final_item);
    created := true;
  end if;

  insert into public.app_config (key, value, updated_at) values (p_key, arr, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('id', item_id, 'item', final_item, 'created', created, 'updated', not created);
end;
$$;
revoke execute on function public.save_config_list_item(text, jsonb) from public, anon;
grant execute on function public.save_config_list_item(text, jsonb) to authenticated;

create or replace function public.delete_config_list_item(p_key text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  arr jsonb;
  new_arr jsonb := '[]'::jsonb;
  elem jsonb;
  removed boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_key not in ('certDefs') then
    raise exception 'Unsupported config key: %', p_key;
  end if;
  if p_id is null or p_id = '' then
    raise exception 'id required';
  end if;

  select value into arr from public.app_config where key = p_key;
  if arr is null then
    return jsonb_build_object('deleted', false);
  end if;

  for elem in select * from jsonb_array_elements(arr) loop
    if elem->>'id' = p_id then
      removed := true;
    else
      new_arr := new_arr || jsonb_build_array(elem);
    end if;
  end loop;

  if not removed then
    return jsonb_build_object('deleted', false);
  end if;

  update public.app_config set value = new_arr, updated_at = now() where key = p_key;
  return jsonb_build_object('deleted', true);
end;
$$;
revoke execute on function public.delete_config_list_item(text, text) from public, anon;
grant execute on function public.delete_config_list_item(text, text) to authenticated;

-- dailyChecklist is a two-phase nested object ({opening:[],closing:[]}),
-- not a flat list, so it gets its own pair rather than reusing
-- save_config_list_item/delete_config_list_item. Ports saveChecklistItem_
-- exactly: an id search spans BOTH phases (an edit can move an item from
-- opening to closing), and delete is a soft delete (active=false), not a
-- removal.
create or replace function public.save_checklist_item(
  p_id text default null,
  p_phase text default 'opening',
  p_text_en text default '',
  p_text_is text default '',
  p_active boolean default true,
  p_sort_order int default 99
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dc jsonb;
  phase text := lower(coalesce(p_phase, 'opening'));
  new_id text;
  found boolean := false;
  opening jsonb := '[]'::jsonb;
  closing jsonb := '[]'::jsonb;
  elem jsonb;
  item jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if phase not in ('opening', 'closing') then phase := 'opening'; end if;

  select value into dc from public.app_config where key = 'dailyChecklist';
  if dc is null then dc := jsonb_build_object('opening', '[]'::jsonb, 'closing', '[]'::jsonb); end if;

  if p_id is not null and p_id <> '' then
    for elem in select * from jsonb_array_elements(coalesce(dc->'opening', '[]'::jsonb)) loop
      if elem->>'id' = p_id then found := true; else opening := opening || jsonb_build_array(elem); end if;
    end loop;
    for elem in select * from jsonb_array_elements(coalesce(dc->'closing', '[]'::jsonb)) loop
      if elem->>'id' = p_id then found := true; else closing := closing || jsonb_build_array(elem); end if;
    end loop;
    if not found then
      raise exception 'Item not found' using errcode = 'P0002';
    end if;
    new_id := p_id;
  else
    opening := coalesce(dc->'opening', '[]'::jsonb);
    closing := coalesce(dc->'closing', '[]'::jsonb);
    new_id := 'chk_' || encode(extensions.gen_random_bytes(8), 'hex');
  end if;

  item := jsonb_build_object(
    'id', new_id, 'phase', phase, 'textEN', coalesce(p_text_en, ''), 'textIS', coalesce(p_text_is, ''),
    'active', coalesce(p_active, true), 'sortOrder', coalesce(p_sort_order, 99)
  );
  if phase = 'opening' then opening := opening || jsonb_build_array(item);
  else closing := closing || jsonb_build_array(item); end if;

  insert into public.app_config (key, value, updated_at)
    values ('dailyChecklist', jsonb_build_object('opening', opening, 'closing', closing), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return case when p_id is not null and p_id <> '' then jsonb_build_object('id', new_id, 'updated', true)
              else jsonb_build_object('id', new_id, 'created', true) end;
end;
$$;
revoke execute on function public.save_checklist_item(text, text, text, text, boolean, int) from public, anon;
grant execute on function public.save_checklist_item(text, text, text, text, boolean, int) to authenticated;

create or replace function public.delete_checklist_item(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dc jsonb;
  opening jsonb := '[]'::jsonb;
  closing jsonb := '[]'::jsonb;
  elem jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_id is null or p_id = '' then
    raise exception 'id required';
  end if;

  select value into dc from public.app_config where key = 'dailyChecklist';
  if dc is null then
    return jsonb_build_object('deleted', true);
  end if;

  for elem in select * from jsonb_array_elements(coalesce(dc->'opening', '[]'::jsonb)) loop
    if elem->>'id' = p_id then elem := jsonb_set(elem, '{active}', 'false'::jsonb); end if;
    opening := opening || jsonb_build_array(elem);
  end loop;
  for elem in select * from jsonb_array_elements(coalesce(dc->'closing', '[]'::jsonb)) loop
    if elem->>'id' = p_id then elem := jsonb_set(elem, '{active}', 'false'::jsonb); end if;
    closing := closing || jsonb_build_array(elem);
  end loop;

  update public.app_config set value = jsonb_build_object('opening', opening, 'closing', closing), updated_at = now()
    where key = 'dailyChecklist';

  return jsonb_build_object('deleted', true);
end;
$$;
revoke execute on function public.delete_checklist_item(text) from public, anon;
grant execute on function public.delete_checklist_item(text) to authenticated;

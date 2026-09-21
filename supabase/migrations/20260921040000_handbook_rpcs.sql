-- Phase 3, domain 1: retrofit handbook.gs's write actions off their
-- one-Edge-Function-per-action shape onto the generic config-list RPCs
-- already built for Domain 5 (save_config_list_item/
-- delete_config_list_item) — handbook.gs's own saveHandbookContact_/
-- saveHandbookRole_/saveHandbookDoc_/saveHandbookInfo_ already call the
-- exact same generic saveConfigListItem_/deleteConfigListItem_ helpers
-- this migration's RPCs were modeled on, so this is a closer match than
-- Domain 5's certDefs case, not a new pattern.
--
-- Every handbook delete is a SOFT delete (deleteConfigListItem_'s
-- {soft:true} option — sets active:false, keeps the row so re-parenting
-- and undo stay possible) rather than certDefs' hard delete, so
-- delete_config_list_item gains a p_soft parameter mirroring the
-- original helper's own `opts.soft` exactly, rather than a new function.
--
-- Deliberately not ported: deleteHandbookDoc_'s DriveApp.trashFile call,
-- uploadHandbookDoc_, syncHandbookDocs_ — all genuine Drive-API needs,
-- same deferral category as the Calendar-touching writes elsewhere in
-- this migration. Their Edge Functions stay as-is.
-- CREATE OR REPLACE can't widen an argument list in place (it would just
-- create a second overload alongside the old 2-arg version) — drop it
-- first so there's one function, one signature.
drop function if exists public.delete_config_list_item(text, text);

create or replace function public.delete_config_list_item(p_key text, p_id text, p_soft boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  arr jsonb;
  new_arr jsonb := '[]'::jsonb;
  elem jsonb;
  found_idx int := null;
  i int;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_key not in ('certDefs', 'handbookRoles', 'handbookContacts', 'handbookDocs', 'handbookInfo') then
    raise exception 'Unsupported config key: %', p_key;
  end if;
  if p_id is null or p_id = '' then
    raise exception 'id required';
  end if;

  select value into arr from public.app_config where key = p_key;
  if arr is null then
    return jsonb_build_object('deleted', false);
  end if;

  if p_soft then
    for i in 0 .. jsonb_array_length(arr) - 1 loop
      if arr->i->>'id' = p_id then found_idx := i; end if;
    end loop;
    if found_idx is null then
      return jsonb_build_object('deactivated', false);
    end if;
    arr := jsonb_set(arr, array[found_idx::text, 'active'], 'false'::jsonb);
    arr := jsonb_set(arr, array[found_idx::text, 'updatedAt'], to_jsonb(now()));
    update public.app_config set value = arr, updated_at = now() where key = p_key;
    return jsonb_build_object('deactivated', true);
  end if;

  for elem in select * from jsonb_array_elements(arr) loop
    if elem->>'id' = p_id then
      -- fall through: item dropped by not appending it to new_arr
      null;
    else
      new_arr := new_arr || jsonb_build_array(elem);
    end if;
  end loop;

  if jsonb_array_length(arr) = jsonb_array_length(new_arr) then
    return jsonb_build_object('deleted', false);
  end if;

  update public.app_config set value = new_arr, updated_at = now() where key = p_key;
  return jsonb_build_object('deleted', true);
end;
$$;
revoke execute on function public.delete_config_list_item(text, text, boolean) from public, anon;
grant execute on function public.delete_config_list_item(text, text, boolean) to authenticated;

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
  if p_key not in ('certDefs', 'handbookRoles', 'handbookContacts', 'handbookDocs', 'handbookInfo') then
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

-- Bulk sortOrder-only patch for the admin reorder arrows — only touches
-- sortOrder + updatedAt on matching items, leaves members/areas untouched
-- (ports reorderHandbookRoles_ exactly).
create or replace function public.reorder_handbook_roles(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  arr jsonb;
  new_arr jsonb := '[]'::jsonb;
  elem jsonb;
  matched_item jsonb;
  new_order int;
  updated_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items required';
  end if;

  select value into arr from public.app_config where key = 'handbookRoles';
  if arr is null then
    return jsonb_build_object('updated', 0);
  end if;

  for elem in select * from jsonb_array_elements(arr) loop
    select req.value into matched_item
      from jsonb_array_elements(p_items) as req(value)
      where req.value->>'id' = elem->>'id'
      limit 1;
    if matched_item is not null then
      new_order := coalesce((matched_item->>'sortOrder')::int, 0);
      elem := jsonb_set(elem, '{sortOrder}', to_jsonb(new_order));
      elem := jsonb_set(elem, '{updatedAt}', to_jsonb(now()));
      updated_count := updated_count + 1;
    end if;
    new_arr := new_arr || jsonb_build_array(elem);
    matched_item := null;
  end loop;

  if updated_count > 0 then
    update public.app_config set value = new_arr, updated_at = now() where key = 'handbookRoles';
  end if;

  return jsonb_build_object('updated', updated_count);
end;
$$;
revoke execute on function public.reorder_handbook_roles(jsonb) from public, anon;
grant execute on function public.reorder_handbook_roles(jsonb) to authenticated;

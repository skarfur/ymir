-- Promotes certDefs from an app_config JSON blob to a real table, same
-- rationale as activity_templates (20260922100000): the app's own
-- config-list helpers (saveConfigListItem_/deleteConfigListItem_ in
-- config.gs, now save_config_list_item/delete_config_list_item here)
-- already treat it as individually-addressable records with ids and
-- delete semantics — it's just been stored as one JSON blob instead of
-- rows.
--
-- Unlike activity_templates, this is NOT fixing a live cast bug: cert
-- ids (`cert_75585c0f3db745a1` etc.) are never stored in a typed `uuid`
-- column anywhere — boats.access_gate_cert is `text`,
-- activity_templates.roles[].requiredEndorsement and
-- members.certifications[].certId are plain jsonb string fields compared
-- as text. So id stays `text` here (not regenerated to uuid) and keeps
-- its exact original values — the two other places that already
-- reference these ids by value (boats.access_gate_cert,
-- activity_templates.roles[].requiredEndorsement) keep resolving
-- correctly with zero changes needed there.
--
-- subcats stays a jsonb sub-column (a nested list, not its own table),
-- same scope decision as activity_templates.roles/bulk_schedule.
--
-- certDefs was the only config-list key using save_config_list_item/
-- delete_config_list_item that isn't a handbook.gs key (see that
-- function's header in 20260921040000_handbook_rpcs.sql) — those RPCs
-- are redefined below to drop 'certDefs' from their allowlist; the
-- handbookRoles/handbookContacts/handbookDocs/handbookInfo behavior is
-- untouched.

create table public.cert_defs (
  id                text primary key,
  name_en           text not null default '',
  name_is           text not null default '',
  description_en    text not null default '',
  description_is    text not null default '',
  category          text not null default '',
  issuing_authority text not null default '',
  color             text not null default '',
  expires           boolean not null default false,
  has_id_number     boolean not null default false,
  club_endorsement  boolean not null default false,
  subcats           jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.cert_defs enable row level security;
revoke all on public.cert_defs from anon, authenticated;

-- ── save_cert_def ────────────────────────────────────────────────────────
-- Ports saveCertDef_. id generation mirrors the scheme
-- save_config_list_item used for certDefs before this migration
-- ('cert_' || 8 random bytes hex) so a brand-new def's id shape is
-- unchanged from an admin's perspective; admin/certs.js no longer
-- fabricates the id client-side (see that file's diff) — it now passes
-- null for a new item and lets this RPC generate one, same as
-- save_activity_type.
create or replace function public.save_cert_def(
  p_id text default null,
  p_name_en text default '',
  p_name_is text default '',
  p_description_en text default '',
  p_description_is text default '',
  p_category text default '',
  p_issuing_authority text default '',
  p_color text default '',
  p_expires boolean default false,
  p_has_id_number boolean default false,
  p_club_endorsement boolean default false,
  p_subcats jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_id text := nullif(trim(p_id), '');
  saved public.cert_defs;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if coalesce(trim(p_name_en), '') = '' then
    raise exception 'saveCertDef failed: name required';
  end if;
  if item_id is null then
    item_id := 'cert_' || encode(extensions.gen_random_bytes(8), 'hex');
  end if;

  insert into public.cert_defs (
    id, name_en, name_is, description_en, description_is, category,
    issuing_authority, color, expires, has_id_number, club_endorsement,
    subcats, updated_at
  ) values (
    item_id, coalesce(p_name_en, ''), coalesce(p_name_is, ''),
    coalesce(p_description_en, ''), coalesce(p_description_is, ''),
    coalesce(p_category, ''), coalesce(p_issuing_authority, ''), coalesce(p_color, ''),
    coalesce(p_expires, false), coalesce(p_has_id_number, false), coalesce(p_club_endorsement, false),
    coalesce(p_subcats, '[]'::jsonb), now()
  )
  on conflict (id) do update set
    name_en = excluded.name_en, name_is = excluded.name_is,
    description_en = excluded.description_en, description_is = excluded.description_is,
    category = excluded.category, issuing_authority = excluded.issuing_authority,
    color = excluded.color, expires = excluded.expires,
    has_id_number = excluded.has_id_number, club_endorsement = excluded.club_endorsement,
    subcats = excluded.subcats, updated_at = now()
  returning * into saved;

  return jsonb_build_object('id', saved.id, 'item', jsonb_build_object(
    'id', saved.id,
    'nameEN', saved.name_en, 'nameIS', saved.name_is, 'name', saved.name_en,
    'descriptionEN', saved.description_en, 'descriptionIS', saved.description_is, 'description', saved.description_en,
    'category', saved.category, 'issuingAuthority', saved.issuing_authority, 'color', saved.color,
    'expires', saved.expires, 'hasIdNumber', saved.has_id_number, 'clubEndorsement', saved.club_endorsement,
    'subcats', saved.subcats
  ));
end;
$$;
revoke execute on function public.save_cert_def(
  text, text, text, text, text, text, text, text, boolean, boolean, boolean, jsonb
) from public, anon;
grant execute on function public.save_cert_def(
  text, text, text, text, text, text, text, text, boolean, boolean, boolean, jsonb
) to authenticated;

-- ── delete_cert_def ─────────────────────────────────────────────────────
-- Hard delete, matching deleteCertDef_'s original behaviour (certDefs
-- never used the soft-delete path handbook keys use).
create or replace function public.delete_cert_def(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_id is null or p_id = '' then
    raise exception 'id required';
  end if;

  delete from public.cert_defs where id = p_id returning id into removed_id;
  return jsonb_build_object('deleted', removed_id is not null);
end;
$$;
revoke execute on function public.delete_cert_def(text) from public, anon;
grant execute on function public.delete_cert_def(text) to authenticated;

-- ── save_config_list_item / delete_config_list_item ────────────────────
-- Same bodies as 20260921040000_handbook_rpcs.sql, minus 'certDefs' from
-- the allowlist (it now has its own dedicated RPCs above). Handbook keys
-- (handbookRoles/handbookContacts/handbookDocs/handbookInfo) are
-- untouched.
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
  if p_key not in ('handbookRoles', 'handbookContacts', 'handbookDocs', 'handbookInfo') then
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
  if p_key not in ('handbookRoles', 'handbookContacts', 'handbookDocs', 'handbookInfo') then
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

-- ── save_member_cert ─────────────────────────────────────────────────────
-- Same body as 20260921152840_members_prefs_certs_alerts_sessions.sql,
-- except the certDefs lookup reads the real table (only .id and
-- .subcats are ever used downstream, so this builds the minimal
-- equivalent jsonb array rather than a full DTO).
create or replace function public.save_member_cert(p_member_id uuid, p_certifications jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_kt text;
  defs jsonb;
  normalized jsonb := '[]'::jsonb;
  cleaned jsonb;
  c jsonb;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_member_id is null then raise exception 'memberId required'; end if;
  if p_certifications is null or jsonb_typeof(p_certifications) <> 'array' then
    raise exception 'certifications array required';
  end if;
  if not public.is_admin() then
    select kennitala into target_kt from public.members where id = p_member_id;
    if target_kt is null or target_kt <> public.current_kennitala() then
      raise exception 'Forbidden' using errcode = '28000';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'subcats', subcats)), '[]'::jsonb)
    into defs from public.cert_defs;

  for c in select * from jsonb_array_elements(p_certifications) loop
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'certId', nullif(c->>'certId', ''),
      'sub', nullif(c->>'sub', ''),
      'category', coalesce(c->>'category', ''),
      'title', coalesce(c->>'title', ''),
      'idNumber', coalesce(nullif(c->>'idNumber', ''), c->>'licenceNumber', ''),
      'issuingAuthority', coalesce(c->>'issuingAuthority', ''),
      'issueDate', coalesce(c->>'issueDate', ''),
      'expires', coalesce((c->>'expires')::boolean, false),
      'expiresAt', coalesce(nullif(c->>'expiresAt', ''), c->>'expiryDate', ''),
      'description', coalesce(c->>'description', ''),
      'assignedBy', coalesce(c->>'assignedBy', ''),
      'assignedAt', coalesce(c->>'assignedAt', ''),
      'verifiedBy', coalesce(nullif(c->>'verifiedBy', ''), c->>'assignedBy', ''),
      'verifiedAt', coalesce(nullif(c->>'verifiedAt', ''), c->>'assignedAt', ''),
      'licenceNumber', coalesce(nullif(c->>'licenceNumber', ''), c->>'idNumber', '')
    ));
  end loop;

  with entries as (
    select coalesce(nullif(e->>'certId', ''), '_custom_' || coalesce(e->>'title', '')) as key, e as entry
    from jsonb_array_elements(normalized) e
  ),
  defs_arr as (
    select d as def, d->>'id' as def_id,
      exists(select 1 from jsonb_array_elements(coalesce(d->'subcats', '[]'::jsonb)) s where (s->>'rank') is not null) as has_ranks
    from jsonb_array_elements(defs) d
  ),
  ranked as (
    select en.key, en.entry, coalesce(dr.has_ranks, false) as has_ranks,
      coalesce((
        select (s->>'rank')::numeric from jsonb_array_elements(coalesce(dr.def->'subcats', '[]'::jsonb)) s
        where s->>'key' = en.entry->>'sub'
      ), 0) as rank
    from entries en
    left join defs_arr dr on dr.def_id = en.key
  ),
  picked as (
    select key, entry, has_ranks, rank,
      row_number() over (partition by key order by rank desc) as rn
    from ranked
  )
  select coalesce(jsonb_agg(entry), '[]'::jsonb) into cleaned
  from picked
  where key like '\_custom\_%' escape '\' or not has_ranks or rn = 1;

  update public.members set certifications = cleaned, updated_at = now() where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;

  return jsonb_build_object('saved', true, 'count', jsonb_array_length(cleaned));
end;
$$;
revoke execute on function public.save_member_cert(uuid, jsonb) from public, anon;
grant execute on function public.save_member_cert(uuid, jsonb) to authenticated;

-- Completes the audit of every apiPost/apiGet action name against
-- _SUPABASE_ACTIONS after discovering the GAS-401-forces-logout bug:
-- these were all still silently routed to the (now permanently broken
-- for auth) Apps Script backend. Ports validateMember_/savePreferences_/
-- saveMemberCert_ (config.gs)/saveCertCategories_ (config.gs)/
-- saveCaptainBio_ (checkouts.gs)/listSessions_/resolveAlert_ and
-- getOverdueAlerts_ (alerts.gs) as Postgres RPC.
--
-- Deliberately NOT included here (each needs more than a plain RPC —
-- either a new Edge Function or an external API bridge, so tracked as
-- separate follow-up work): validateWard_ (mints a session + JWT for the
-- ward — needs Deno's signing key, not just SQL), linkGoogleAccount_/
-- unlinkGoogleAccount_/loginWithGoogle_ (verifies a Google ID token
-- server-side), uploadHeadshot_ (Google Drive). silenceAlert_/
-- snoozeAlert_ have zero frontend callers (resolveAlert covers all three
-- ops the staff panel actually uses) so they're not ported either.

alter table public.members add column if not exists bio text not null default '';
alter table public.members add column if not exists headshot_url text not null default '';
alter table public.sessions add column if not exists user_agent text;

-- ── validateMember_ ────────────────────────────────────────────────────────
-- Needed because members SELECT is admin-only RLS (member_crud.sql) — a
-- non-admin member can't otherwise re-read their own row at all.
create or replace function public.validate_member(p_kennitala text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.members;
  caller_kt text;
  is_minor boolean;
  g_name text; g_kt text; g_phone text;
  wards jsonb;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_kennitala is null or trim(p_kennitala) = '' then
    raise exception 'kennitala required';
  end if;
  caller_kt := public.current_kennitala();
  if p_kennitala <> caller_kt and not public.is_admin() then
    raise exception 'Forbidden' using errcode = '28000';
  end if;

  select * into m from public.members where kennitala = p_kennitala;
  if not found then raise exception 'Not found'; end if;
  if not m.active then raise exception 'Inactive account' using errcode = '28000'; end if;

  is_minor := m.birth_year is not null and (extract(year from now())::int - m.birth_year) < 18;
  select name, kennitala, phone into g_name, g_kt, g_phone from public.guardians where member_id = m.id limit 1;

  wards := '[]'::jsonb;
  if not is_minor then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'kennitala', w.kennitala, 'name', w.name,
      'birthYear', coalesce(w.birth_year::text, '')
    )), '[]'::jsonb) into wards
    from public.members w
    join public.guardians gd on gd.member_id = w.id
    where gd.kennitala = p_kennitala and w.active
      and w.birth_year is not null and (extract(year from now())::int - w.birth_year) < 18;
  end if;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', m.id, 'kennitala', m.kennitala, 'name', m.name, 'role', m.role,
      'email', coalesce(m.email, ''), 'phone', coalesce(m.phone, ''),
      'birthYear', coalesce(m.birth_year::text, ''), 'isMinor', is_minor,
      'guardianName', coalesce(g_name, ''), 'guardianKennitala', coalesce(g_kt, ''), 'guardianPhone', coalesce(g_phone, ''),
      'certifications', coalesce(m.certifications, '[]'::jsonb),
      'initials', coalesce(nullif(m.initials, ''), public.extract_initials_(m.name)),
      'preferences', coalesce(m.preferences, '{}'::jsonb),
      'bio', coalesce(m.bio, ''), 'headshotUrl', coalesce(m.headshot_url, ''),
      'googleEmail', coalesce(m.google_email, '')
    ),
    'wards', wards
  );
end;
$$;
revoke execute on function public.validate_member(text) from public, anon;
grant execute on function public.validate_member(text) to authenticated;

-- ── savePreferences_ ───────────────────────────────────────────────────────
create or replace function public.save_preferences(
  p_kennitala text,
  p_initials text default null,
  p_preferences jsonb default null,
  p_lang text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ex public.members;
  prefs jsonb;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_kennitala is null or trim(p_kennitala) = '' then raise exception 'kennitala required'; end if;
  if p_kennitala <> public.current_kennitala() and not public.is_admin() then
    raise exception 'Forbidden' using errcode = '28000';
  end if;
  select * into ex from public.members where kennitala = p_kennitala;
  if not found then raise exception 'Member not found'; end if;

  prefs := p_preferences;
  if p_lang is not null and upper(p_lang) in ('EN', 'IS') then
    if prefs is null then prefs := coalesce(ex.preferences, '{}'::jsonb); end if;
    prefs := jsonb_set(prefs, '{lang}', to_jsonb(upper(p_lang)));
  end if;

  update public.members set
    initials = case when p_initials is not null then coalesce(nullif(upper(trim(p_initials)), ''), public.extract_initials_(ex.name)) else initials end,
    preferences = coalesce(prefs, preferences),
    updated_at = now()
  where kennitala = p_kennitala;

  return jsonb_build_object('saved', true);
end;
$$;
revoke execute on function public.save_preferences(text, text, jsonb, text) from public, anon;
grant execute on function public.save_preferences(text, text, jsonb, text) to authenticated;

-- ── saveMemberCert_ ────────────────────────────────────────────────────────
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

  select value into defs from public.app_config where key = 'certDefs';
  defs := coalesce(defs, '[]'::jsonb);

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

-- ── saveCertCategories_ ────────────────────────────────────────────────────
create or replace function public.save_cert_categories(p_categories jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized jsonb := '[]'::jsonb;
  c jsonb;
  v_key text;
  label_en text;
  label_is text;
  seen jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_categories is null or jsonb_typeof(p_categories) <> 'array' then
    raise exception 'categories array required';
  end if;

  for c in select * from jsonb_array_elements(p_categories) loop
    if jsonb_typeof(c) = 'string' then
      v_key := trim(both from (c #>> '{}'));
      label_en := v_key; label_is := '';
    else
      label_en := trim(both from coalesce(c->>'labelEN', c->>'label', c->>'key', ''));
      v_key := trim(both from coalesce(c->>'key', label_en));
      label_is := trim(both from coalesce(c->>'labelIS', ''));
      if label_en = '' then label_en := v_key; end if;
    end if;
    if v_key = '' or (seen ? v_key) then continue; end if;
    seen := seen || jsonb_build_object(v_key, true);
    normalized := normalized || jsonb_build_array(jsonb_build_object('key', v_key, 'labelEN', label_en, 'labelIS', label_is));
  end loop;

  insert into public.app_config (key, value, updated_at) values ('certCategories', normalized, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('saved', true, 'count', jsonb_array_length(normalized));
end;
$$;
revoke execute on function public.save_cert_categories(jsonb) from public, anon;
grant execute on function public.save_cert_categories(jsonb) to authenticated;

-- ── saveCaptainBio_ ────────────────────────────────────────────────────────
-- Original had no self-or-admin gate at all (any authenticated caller
-- could overwrite any kennitala's bio) — every real call site only ever
-- sends the caller's own kennitala, so this closes what looks like an
-- oversight rather than a deliberate design choice, matching how this
-- migration series has handled similarly clear-cut gaps.
create or replace function public.save_captain_bio(p_kennitala text, p_bio text default null, p_headshot_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_kennitala is null or trim(p_kennitala) = '' then raise exception 'kennitala required'; end if;
  if p_kennitala <> public.current_kennitala() and not public.is_admin() then
    raise exception 'Forbidden' using errcode = '28000';
  end if;
  if not exists (select 1 from public.members where kennitala = p_kennitala) then
    raise exception 'Member not found';
  end if;
  update public.members set
    bio = case when p_bio is not null then p_bio else bio end,
    headshot_url = case when p_headshot_url is not null then p_headshot_url else headshot_url end,
    updated_at = now()
  where kennitala = p_kennitala;
  return jsonb_build_object('saved', true);
end;
$$;
revoke execute on function public.save_captain_bio(text, text, text) from public, anon;
grant execute on function public.save_captain_bio(text, text, text) to authenticated;

-- ── listSessions_ ──────────────────────────────────────────────────────────
create or replace function public.list_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_session_id uuid;
  rows_ jsonb;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  cur_session_id := (auth.jwt()->>'session_id')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'createdAt', s.created_at, 'lastSeenAt', s.last_seen_at, 'expiresAt', s.expires_at,
    'stayLoggedIn', coalesce(s.stay_logged_in, false), 'userAgent', coalesce(s.user_agent, ''),
    'isCurrent', s.id = cur_session_id
  ) order by s.last_seen_at desc nulls last), '[]'::jsonb) into rows_
  from public.sessions s
  where s.member_id = public.current_member_id() and s.expires_at > now();

  return jsonb_build_object('sessions', rows_);
end;
$$;
revoke execute on function public.list_sessions() from public, anon;
grant execute on function public.list_sessions() to authenticated;

-- ── getOverdueAlerts_ / resolveAlert_ (alerts.gs) ──────────────────────────
create or replace function public.get_overdue_alerts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb;
  first_alert_mins int;
  snooze_mins int;
  alerts jsonb;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;
  select value into cfg from public.app_config where key = 'overdueAlerts';
  first_alert_mins := coalesce((cfg->>'firstAlertMins')::int, 15);
  snooze_mins := coalesce((cfg->>'snoozeMins')::int, 30);
  if cfg is not null and (cfg->>'enabled') = 'false' then
    return jsonb_build_object('success', true, 'alerts', '[]'::jsonb, 'snoozeMins', snooze_mins);
  end if;

  -- checkouts.alert_first_sent is timestamptz (when the first alert was
  -- sent), not boolean; firstAlertSent in the response is a plain
  -- boolean flag, matching the original's !!row[col('alertFirstSent')].
  select coalesce(jsonb_agg(a.obj order by (a.obj->>'minutesOverdue')::int desc), '[]'::jsonb) into alerts
  from (
    select jsonb_build_object(
      'checkoutId', c.id::text,
      'boatName', coalesce(nullif(c.boat_name, ''), '—'),
      'memberName', coalesce(nullif(c.member_name, ''), '—'),
      'memberPhone', coalesce(c.member_phone, ''),
      'isMinor', coalesce(c.member_is_minor, false),
      'guardianName', coalesce(c.guardian_name, ''),
      'guardianPhone', coalesce(c.guardian_phone, ''),
      'locationName', coalesce(nullif(c.location_name, ''), '—'),
      'expectedReturn', to_char(c.expected_return at time zone 'UTC', 'HH24:MI'),
      'minutesOverdue', floor(extract(epoch from (now() - c.expected_return)) / 60)::int,
      'checkoutDate', to_char(c.checked_out_at at time zone 'UTC', 'YYYY-MM-DD'),
      'launchTime', to_char(c.checked_out_at at time zone 'UTC', 'HH24:MI'),
      'firstAlertSent', c.alert_first_sent is not null,
      -- Built via concatenation rather than to_char's 'T'/'Z' literal
      -- quoting (which broke the statement during verification).
      'snoozedUntil', case when c.alert_snoozed_until is not null and c.alert_snoozed_until > now()
                           then to_char(c.alert_snoozed_until at time zone 'UTC', 'YYYY-MM-DD') || 'T' ||
                                to_char(c.alert_snoozed_until at time zone 'UTC', 'HH24:MI:SS') || 'Z'
                           else null end
    ) as obj
    from public.checkouts c
    where c.status = 'out'
      and c.expected_return is not null
      and floor(extract(epoch from (now() - c.expected_return)) / 60) >= first_alert_mins
  ) a;

  return jsonb_build_object('success', true, 'alerts', alerts, 'snoozeMins', snooze_mins);
end;
$$;
revoke execute on function public.get_overdue_alerts() from public, anon;
grant execute on function public.get_overdue_alerts() to authenticated;

create or replace function public.resolve_alert(p_checkout_id uuid, p_op text default 'silence')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb;
  snooze_mins int;
  until timestamptz;
begin
  if not public.is_staff_or_admin() then
    raise exception 'Staff only' using errcode = '28000';
  end if;
  if p_checkout_id is null then raise exception 'Missing id'; end if;
  if not exists (select 1 from public.checkouts where id = p_checkout_id) then
    raise exception 'Checkout not found';
  end if;

  update public.checkouts set alert_silenced = true where id = p_checkout_id;

  if p_op = 'checkInAndClose' then
    update public.checkouts set
      status = 'in', checked_in_at = now(), notes = 'Skráð inn í gegnum viðvörun á vef.'
    where id = p_checkout_id;
  elsif p_op = 'snooze' then
    select value into cfg from public.app_config where key = 'overdueAlerts';
    snooze_mins := coalesce((cfg->>'snoozeMins')::int, 30);
    until := now() + (snooze_mins || ' minutes')::interval;
    update public.checkouts set alert_snoozed_until = until, alert_silenced = false where id = p_checkout_id;
  end if;

  return jsonb_build_object('ok', true, 'op', coalesce(p_op, 'silence'));
end;
$$;
revoke execute on function public.resolve_alert(uuid, text) from public, anon;
grant execute on function public.resolve_alert(uuid, text) to authenticated;

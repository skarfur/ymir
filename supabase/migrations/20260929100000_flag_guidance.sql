-- Flag system overhaul: four flags (green / yellow / red / black), recalibrated
-- scoring, per-boat-class and per-activity guidance, and a checkout gate that
-- turns the guidance into rules.
--
-- 1. flagConfig (app_config) gets the new scoring values, rewritten advice
--    text (orange folded into red, Icelandic fixes) and a `guidance` object:
--      guidance.profiles[profileKey][flagKey] = { s, en, is }
--        s ∈ ok | cond | approval | no
--      guidance.boatProfiles[boatId] = profileKey   (overrides boat.category)
--      guidance.activities[activityTemplateId][flagKey] = { s, en, is }
--        s ∈ go | adjust | cancel
--    shared/weather.js holds the same defaults (FLAG_GUIDANCE_DEFAULTS) for
--    display and for the admin "Reset to defaults" button. Everything stays
--    admin-editable via save_config_value('flagConfig', …).
-- 2. checkouts gains the flag + guidance the checkout was judged under, and
--    approval bookkeeping.
-- 3. save_checkout enforces the guidance for self-service checkouts:
--      ok / cond → status 'out' (as before)
--      approval  → status 'pending' until staff/captain approve or deny it
--                  via decide_checkout
--      no        → rejected
--    Staff, admins and captains are not gated (they are the approvers), but
--    the guidance they checked out under is still recorded.
--    The flag comes from the client's weather snapshot (the score is computed
--    client-side from Open-Meteo/Vedur data), except that an active staff
--    flagOverride always wins. A missing/unknown flag is treated as
--    'approval' for any boat class that has guidance, so dropping the
--    snapshot can't skip the gate.

-- ── 1. checkouts columns ──────────────────────────────────────────────────
alter table public.checkouts add column if not exists flag_key text;
alter table public.checkouts add column if not exists guidance_profile text;
alter table public.checkouts add column if not exists guidance_status text;
alter table public.checkouts add column if not exists approved_by uuid references public.members(id);
alter table public.checkouts add column if not exists approved_by_name text;
alter table public.checkouts add column if not exists approved_at timestamptz;
alter table public.checkouts add column if not exists approval_note text;

-- ── 2. flagConfig values + guidance ───────────────────────────────────────
do $$
declare
  cfg jsonb;
  profiles jsonb;
  boat_profiles jsonb;
  activities jsonb;
begin
  select value into cfg from public.app_config where key = 'flagConfig';
  cfg := coalesce(cfg, '{}'::jsonb);

  profiles := $j${
    "keelboat": {
      "green":  {"s": "ok"},
      "yellow": {"s": "ok", "en": "Reef early.", "is": "Rifið snemma."},
      "red":    {"s": "approval", "en": "Experienced skipper, at least 2 crew, reefed.", "is": "Reyndur skipstjóri, a.m.k. 2 í áhöfn, rifað."},
      "black":  {"s": "no"}
    },
    "dinghy": {
      "green":  {"s": "ok", "en": "According to your certification.", "is": "Samkvæmt réttindum."},
      "yellow": {"s": "cond", "en": "Experienced sailors only. Beginners only inside Fossvogur with staff and a support boat on duty.", "is": "Aðeins reyndir siglarar. Byrjendur aðeins innan Fossvogs þegar starfsfólk og gæslubátur eru á vakt."},
      "red":    {"s": "approval", "en": "Experienced sailors only, support boat on the water.", "is": "Aðeins reyndir siglarar, gæslubátur á sjó."},
      "black":  {"s": "no"}
    },
    "optimist": {
      "labelEN": "Optimist", "labelIS": "Optimist",
      "green":  {"s": "cond", "en": "Supervised sessions only.", "is": "Aðeins undir eftirliti."},
      "yellow": {"s": "cond", "en": "Coached sessions with a support boat, sheltered area only.", "is": "Aðeins á æfingum með þjálfara og gæslubát, í skjóli."},
      "red":    {"s": "no"},
      "black":  {"s": "no"}
    },
    "wingfoil": {
      "green":  {"s": "ok"},
      "yellow": {"s": "ok"},
      "red":    {"s": "approval", "en": "Experienced riders only, support boat on the water, not in offshore wind.", "is": "Aðeins reyndir, gæslubátur á sjó, ekki í aflandsvindi."},
      "black":  {"s": "no"}
    },
    "kayak": {
      "green":  {"s": "ok"},
      "yellow": {"s": "cond", "en": "Experienced paddlers only. Stay inside Fossvogur, not in easterly (offshore) wind.", "is": "Aðeins reyndir ræðarar. Haldið ykkur innan Fossvogs, ekki í austlægri (aflands) átt."},
      "red":    {"s": "no"},
      "black":  {"s": "no"}
    },
    "rowboat": {
      "green":  {"s": "ok"},
      "yellow": {"s": "cond", "en": "Inside Fossvogur only.", "is": "Aðeins innan Fossvogs."},
      "red":    {"s": "no"},
      "black":  {"s": "no"}
    },
    "rowing-shell": {
      "green":  {"s": "cond", "en": "Flat water only.", "is": "Aðeins á sléttum sjó."},
      "yellow": {"s": "no"},
      "red":    {"s": "no"},
      "black":  {"s": "no"}
    },
    "sup": {
      "green":  {"s": "cond", "en": "Leash and buoyancy aid; not in offshore wind.", "is": "Ól og flotvesti; ekki í aflandsvindi."},
      "yellow": {"s": "no", "en": "Coached sessions only.", "is": "Aðeins á skipulögðum æfingum."},
      "red":    {"s": "no"},
      "black":  {"s": "no"}
    },
    "support-boat": {
      "green":  {"s": "ok"},
      "yellow": {"s": "ok"},
      "red":    {"s": "ok"},
      "black":  {"s": "approval", "en": "Rescue or recovery only.", "is": "Aðeins til björgunar eða að sækja báta."}
    }
  }$j$::jsonb;

  -- Optimists are dinghies but get their own, stricter profile.
  select coalesce(jsonb_object_agg(b.id::text, 'optimist'), '{}'::jsonb) into boat_profiles
    from public.boats b where b.name ilike 'optimist%';

  -- Activity guidance, matched to the imported activity templates by name.
  with g(name, guidance) as (values
    ('learn to sail – kids', $j${"green":{"s":"go"},"yellow":{"s":"adjust","en":"Sheltered area close to shore with an extra support boat, or ashore.","is":"Í skjóli nálægt landi með auka gæslubát, eða í landi."},"red":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."},"black":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."}}$j$::jsonb),
    ('leikur við sjóinn', $j${"green":{"s":"go"},"yellow":{"s":"adjust","en":"Sheltered area close to shore with an extra support boat, or ashore.","is":"Í skjóli nálægt landi með auka gæslubát, eða í landi."},"red":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."},"black":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."}}$j$::jsonb),
    ('sea scouts 5–7th grade', $j${"green":{"s":"go"},"yellow":{"s":"adjust","en":"Sheltered area close to shore with an extra support boat, or ashore.","is":"Í skjóli nálægt landi með auka gæslubát, eða í landi."},"red":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."},"black":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."}}$j$::jsonb),
    ('advanced sailing – kids', $j${"green":{"s":"go"},"yellow":{"s":"go","en":"Support boat on the water.","is":"Gæslubátur á sjó."},"red":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."},"black":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."}}$j$::jsonb),
    ('sea scouts 8–10th grade', $j${"green":{"s":"go"},"yellow":{"s":"go","en":"Support boat on the water.","is":"Gæslubátur á sjó."},"red":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."},"black":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."}}$j$::jsonb),
    ('learn to sail – open', $j${"green":{"s":"go"},"yellow":{"s":"adjust","en":"Restricted area, reduced sail.","is":"Takmarkað svæði, minnkuð segl."},"red":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."},"black":{"s":"cancel","en":"Ashore / theory.","is":"Í landi / bókleg kennsla."}}$j$::jsonb),
    ('advanced sailing – open', $j${"green":{"s":"go"},"yellow":{"s":"go"},"red":{"s":"adjust","en":"Instructor decides: reefed, instructor aboard.","is":"Leiðbeinandi ákveður: rifað, leiðbeinandi um borð."},"black":{"s":"cancel"}}$j$::jsonb),
    ('keelboat 1', $j${"green":{"s":"go"},"yellow":{"s":"go"},"red":{"s":"adjust","en":"Instructor decides: reefed, instructor aboard.","is":"Leiðbeinandi ákveður: rifað, leiðbeinandi um borð."},"black":{"s":"cancel"}}$j$::jsonb),
    ('crew sailing', $j${"green":{"s":"go"},"yellow":{"s":"go"},"red":{"s":"adjust","en":"Skipper and staff approval.","is":"Samþykki skipstjóra og starfsfólks."},"black":{"s":"cancel"}}$j$::jsonb),
    ('open house – club sailing', $j${"green":{"s":"go"},"yellow":{"s":"go","en":"Each boat follows its class guidance.","is":"Hver bátur fylgir leiðbeiningum síns flokks."},"red":{"s":"adjust","en":"Each boat follows its class guidance.","is":"Hver bátur fylgir leiðbeiningum síns flokks."},"black":{"s":"cancel"}}$j$::jsonb),
    ('rowing – skills assessment & open practice', $j${"green":{"s":"go"},"yellow":{"s":"adjust","en":"Rowboats only, inside Fossvogur, no shells.","is":"Aðeins árabátar, innan Fossvogs, engir kappróðrarbátar."},"red":{"s":"cancel"},"black":{"s":"cancel"}}$j$::jsonb),
    ('open wingfoil training', $j${"green":{"s":"go","en":"Light wind may not be worth a session.","is":"Lítill vindur – gæti ekki borgað sig."},"yellow":{"s":"go"},"red":{"s":"adjust","en":"With staff approval and a support boat on the water.","is":"Með samþykki starfsfólks og gæslubát á sjó."},"black":{"s":"cancel"}}$j$::jsonb)
  )
  select coalesce(jsonb_object_agg(t.id::text, g.guidance), '{}'::jsonb) into activities
    from public.activity_templates t join g on lower(t.name) = g.name;

  cfg := cfg
    || jsonb_build_object(
      'thresholds', jsonb_build_object('yellow', 20, 'red', 40, 'black', 80),
      'hysteresis', 5,
      'wind', $j$[{"maxBft":3,"pts":0},{"maxBft":4,"pts":8},{"maxBft":5,"pts":20},{"maxBft":6,"pts":40},{"maxBft":7,"pts":60},{"maxBft":12,"pts":80}]$j$::jsonb,
      'windDirModifier', $j${"dirs":["NNE","NE","ENE","E","ESE","SE"],"pts":6,"minBft":3}$j$::jsonb,
      'gustModifier1Pts', 0,
      'gustModifier2Pts', 10,
      'waves', $j$[{"maxM":0.5,"pts":0},{"maxM":1,"pts":3},{"maxM":1.5,"pts":6},{"maxM":2,"pts":10},{"maxM":3,"pts":16},{"maxM":99,"pts":26}]$j$::jsonb,
      'sst', $j$[{"minC":12,"pts":0},{"minC":10,"pts":2},{"minC":8,"pts":4},{"minC":5,"pts":7},{"minC":2,"pts":10},{"minC":-99,"pts":12}]$j$::jsonb,
      'feelsLike', $j$[{"minC":5,"pts":0},{"minC":0,"pts":3},{"minC":-5,"pts":6},{"minC":-99,"pts":10}]$j$::jsonb,
      'visibility', $j${"good":0,"reduced":8,"poor":30}$j$::jsonb,
      'flags', $j${
        "green":  {"advice": "Good conditions – open to all qualified members.",
                   "adviceIS": "Góðar aðstæður – opið öllum félögum með tilskilin réttindi.",
                   "description": "Conditions are suitable for all boats and experience levels, according to your certification. Check the guidance for your boat below.",
                   "descriptionIS": "Aðstæður henta öllum bátum og reynslustigum, samkvæmt réttindum hvers og eins. Kynntu þér leiðbeiningar fyrir þinn bát hér að neðan."},
        "yellow": {"advice": "Marginal conditions – experienced sailors, or sheltered area with safety cover.",
                   "adviceIS": "Jaðaraðstæður – aðeins reyndir siglarar, eða innan Fossvogs með öryggisgæslu.",
                   "description": "Conditions are marginal. Only experienced sailors with strong boat-handling skills should go out. Others may sail within Fossvogur if staff and a support boat are on duty. Check the guidance for your boat below.",
                   "descriptionIS": "Aðstæður eru á mörkunum. Aðeins reyndir siglarar ættu að fara á sjó. Aðrir geta siglt innan Fossvogs ef starfsfólk og gæslubátur eru á vakt. Kynntu þér leiðbeiningar fyrir þinn bát hér að neðan."},
        "red":    {"advice": "Hazardous conditions – staff or captain approval required for every checkout.",
                   "adviceIS": "Hættulegar aðstæður – starfsmaður eða skipstjóri þarf að samþykkja hverja útskráningu.",
                   "description": "Rescue with club equipment may be difficult or impossible. Only suitable boats may go out, with safety cover on the water, and a staff member or captain must assess and approve every checkout.",
                   "descriptionIS": "Björgun með búnaði klúbbsins getur verið erfið eða ómöguleg. Aðeins hentugir bátar mega fara á sjó, með öryggisgæslu á sjónum, og starfsmaður eða skipstjóri þarf að meta aðstæður og samþykkja hverja útskráningu."},
        "black":  {"advice": "Water closed – all sailing suspended.",
                   "adviceIS": "Siglingasvæðið lokað – allar siglingar stöðvaðar.",
                   "description": "The water is closed to all sailing. All boats must remain ashore or return to harbour immediately. Check back later for updated conditions.",
                   "descriptionIS": "Siglingasvæðið er lokað. Allir bátar skulu vera á landi eða snúa tafarlaust aftur til hafnar. Fylgstu með uppfærðum aðstæðum."}
      }$j$::jsonb,
      'guidance', jsonb_build_object('profiles', profiles, 'boatProfiles', boat_profiles, 'activities', activities)
    );

  insert into public.app_config (key, value, updated_at) values ('flagConfig', cfg, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();

  -- A staff override still set to the retired orange flag becomes red.
  update public.app_config
     set value = jsonb_set(value, '{flagKey}', '"red"'), updated_at = now()
   where key = 'flagOverride' and value->>'flagKey' = 'orange';
end;
$$;

-- ── 3. helpers ────────────────────────────────────────────────────────────
-- Staff, admins and captains approve red-flag checkouts (and aren't gated).
create or replace function public.is_flag_approver_() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.session_valid() and public.current_app_role() in ('staff', 'admin', 'captain');
$$;

-- The flag a checkout is judged under: an active, unexpired staff override
-- wins; otherwise the client's scored flag. Legacy 'orange' maps to 'red'.
-- Returns null when nothing usable was supplied.
create or replace function public.flag_effective_key_(p_client text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  ov jsonb;
  k text;
begin
  select value into ov from public.app_config where key = 'flagOverride';
  if ov is not null and ov->>'active' = 'true'
     and (coalesce(ov->>'expiresAt', '') = '' or (ov->>'expiresAt')::timestamptz > now()) then
    k := ov->>'flagKey';
  else
    k := p_client;
  end if;
  k := lower(trim(coalesce(k, '')));
  if k = 'orange' then k := 'red'; end if;
  if k not in ('green', 'yellow', 'red', 'black') then return null; end if;
  return k;
end;
$$;

-- Guidance profile for a boat: an explicit boatProfiles entry (if that
-- profile exists), else the boat category.
create or replace function public.flag_guidance_profile_(p_boat_id uuid, p_category text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  g jsonb;
  ov text;
begin
  select value->'guidance' into g from public.app_config where key = 'flagConfig';
  if g is not null and p_boat_id is not null then
    ov := g->'boatProfiles'->>(p_boat_id::text);
    if ov is not null and g->'profiles' ? ov then return ov; end if;
  end if;
  return lower(trim(coalesce(p_category, '')));
end;
$$;

-- ok | cond | approval | no for a profile under a flag. A profile with no
-- guidance at all is 'ok'; an unknown flag on a guided profile is 'approval'.
create or replace function public.flag_guidance_status_(p_profile text, p_flag text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  p jsonb;
  st text;
begin
  select value->'guidance'->'profiles'->p_profile into p from public.app_config where key = 'flagConfig';
  if p is null or jsonb_typeof(p) <> 'object' then return 'ok'; end if;
  if p_flag is null then return 'approval'; end if;
  st := p->p_flag->>'s';
  if st is null or st not in ('ok', 'cond', 'approval', 'no') then return 'ok'; end if;
  return st;
end;
$$;

revoke execute on function public.is_flag_approver_() from public, anon;
grant execute on function public.is_flag_approver_() to authenticated;
revoke execute on function public.flag_effective_key_(text) from public, anon, authenticated;
revoke execute on function public.flag_guidance_profile_(uuid, text) from public, anon, authenticated;
revoke execute on function public.flag_guidance_status_(text, text) from public, anon, authenticated;

-- ── 4. save_checkout with the flag gate ───────────────────────────────────
-- Same signature and behavior as 20260921114852_checkouts_domain.sql, plus
-- the gate described in the header. Returns status so the client can tell a
-- pending request from a checkout.
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
  approver boolean := public.is_flag_approver_();
  eff_flag text;
  profile text;
  g_status text;
  new_status text := 'out';
  approver_name text := null;
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

  -- ── Flag gate ──
  eff_flag := public.flag_effective_key_(p_wx_snapshot->>'flag');
  profile  := public.flag_guidance_profile_(boat_uuid, coalesce(p_boat_category, ''));
  g_status := public.flag_guidance_status_(profile, eff_flag);
  if not approver then
    if g_status = 'no' then
      raise exception 'FLAG_BLOCKED: % boats are not allowed out under the % flag', coalesce(nullif(profile, ''), 'These'), coalesce(eff_flag, 'current')
        using errcode = 'P0001';
    elsif g_status = 'approval' then
      new_status := 'pending';
    end if;
  elsif g_status in ('approval', 'no') then
    -- An approver checking out under a gated flag is recorded as the approval.
    select name into approver_name from public.members where id = public.current_member_id();
  end if;

  insert into public.checkouts (
    member_id, member_kennitala, member_name, boat_id, boat_name, boat_category,
    location_id, location_name, crew_count, crew, expected_return, wx_snapshot,
    pre_launch_checklist, notes, status, departure_port, non_club,
    member_phone, member_is_minor, guardian_name, guardian_phone, actor_id, checked_out_at,
    flag_key, guidance_profile, guidance_status,
    approved_by, approved_by_name, approved_at
  ) values (
    mem.id, kt, coalesce(p_member_name, ''), boat_uuid, coalesce(p_boat_name, ''), coalesce(p_boat_category, ''),
    loc_uuid, coalesce(p_location_name, ''), coalesce(p_crew, 1), coalesce(p_crew_names, '[]'::jsonb),
    public.checkouts_time_to_ts_(p_expected_return, today), public.normalize_wx_snapshot_(p_wx_snapshot),
    p_pre_launch_checklist, coalesce(p_notes, ''), new_status, coalesce(p_departure_port, ''), coalesce(p_non_club, false),
    coalesce(mem.phone, ''), is_minor, guardian_name, guardian_phone, public.current_member_id(),
    coalesce(public.checkouts_time_to_ts_(p_checked_out_at, today), now()),
    eff_flag, nullif(profile, ''), g_status,
    case when approver_name is not null then public.current_member_id() end,
    approver_name,
    case when approver_name is not null then now() end
  ) returning id into new_id;

  return jsonb_build_object('id', new_id, 'created', true, 'status', new_status,
    'flagKey', eff_flag, 'guidanceStatus', g_status);
end;
$$;
revoke execute on function public.save_checkout(text,text,text,text,text,text,text,int,jsonb,text,text,jsonb,jsonb,text,boolean,text) from public, anon;
grant execute on function public.save_checkout(text,text,text,text,text,text,text,int,jsonb,text,text,jsonb,jsonb,text,boolean,text) to authenticated;

-- ── 5. approve / deny / cancel ────────────────────────────────────────────
create or replace function public.decide_checkout(p_id uuid, p_approve boolean, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  co record;
  approver_name text;
  new_status text;
begin
  if not public.is_flag_approver_() then
    raise exception 'Staff or captain only' using errcode = '28000';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;
  select id, status into co from public.checkouts where id = p_id for update;
  if not found then
    raise exception 'Checkout not found';
  end if;
  if co.status <> 'pending' then
    raise exception 'Checkout is not awaiting approval (status: %)', co.status;
  end if;
  select name into approver_name from public.members where id = public.current_member_id();
  new_status := case when p_approve then 'out' else 'denied' end;

  update public.checkouts set
    status = new_status,
    -- The boat leaves when it's approved, not when it was requested.
    checked_out_at = case when p_approve then greatest(checked_out_at, now()) else checked_out_at end,
    approved_by = public.current_member_id(),
    approved_by_name = coalesce(approver_name, ''),
    approved_at = now(),
    approval_note = coalesce(p_note, '')
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', new_status);
end;
$$;
revoke execute on function public.decide_checkout(uuid, boolean, text) from public, anon;
grant execute on function public.decide_checkout(uuid, boolean, text) to authenticated;

-- A member withdraws their own pending request.
create or replace function public.cancel_checkout_request(p_id uuid) returns jsonb
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
  delete from public.checkouts
   where id = p_id and status = 'pending'
     and (member_id = public.current_member_id() or member_kennitala = public.current_kennitala()
          or public.is_flag_approver_())
  returning id into deleted_id;
  return jsonb_build_object('deleted', deleted_id is not null);
end;
$$;
revoke execute on function public.cancel_checkout_request(uuid) from public, anon;
grant execute on function public.cancel_checkout_request(uuid) to authenticated;

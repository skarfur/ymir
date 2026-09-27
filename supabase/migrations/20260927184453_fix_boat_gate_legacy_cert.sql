-- Fixes member_satisfies_boat_gate_() to match shared/boats.js's
-- normalizeAccessGate()/memberHasGate() semantics for boats that only
-- have the legacy flat access_gate_cert set (access_gate jsonb is null).
--
-- Bug: Sif/Gulla/Vogun predate the structured access_gate column and only
-- ever got a bare subcat-key string in access_gate_cert (e.g. 'captain',
-- 'released_rower') -- never a real cert_defs.id (e.g. 'cert_mn9l9294').
-- The original member_satisfies_boat_gate_ (20260926100000_bryggjan.sql)
-- treated access_gate_cert as if it already WAS a certId and compared it
-- directly against each cert's certId, which can never match a bare
-- subcat key -- so a Captain-certified member (certId 'cert_mn9l9294',
-- sub 'captain') was rejected from Sif (access_gate_cert = 'captain')
-- even though they hold the right credential. This is what blocked Steve
-- Shema from organizing a Sif post.
--
-- Also fixes the same stale-source bug save_member_cert already had
-- before 20260922110000_cert_defs_table.sql fixed it there: certDefs was
-- promoted from an app_config JSON blob to the public.cert_defs table on
-- 2026-09-22, but this function (written 2026-09-26, after that
-- migration) still read `app_config where key = 'certDefs'`, which no
-- longer exists -- so ranked (minRank) gates could never be satisfied by
-- anyone, silently.
create or replace function public.member_satisfies_boat_gate_(p_kennitala text, p_boat_id uuid) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  boat public.boats;
  gate_certid text;
  gate_sub text;
  min_rank numeric;
  legacy_raw text;
  member_certs jsonb;
  matched boolean := false;
  c jsonb;
  cert_rank numeric;
  now_iso text := to_char(now(), 'YYYY-MM-DD');
begin
  if p_kennitala is null or p_kennitala = '' then return false; end if;
  select * into boat from public.boats where id = p_boat_id;
  if not found then return false; end if;
  if coalesce(boat.access_mode, 'free') <> 'controlled' then return true; end if;

  if boat.access_allowlist is not null and jsonb_typeof(boat.access_allowlist) = 'array' then
    if exists (select 1 from jsonb_array_elements_text(boat.access_allowlist) a where a = p_kennitala) then
      return true;
    end if;
  end if;

  gate_certid := null;
  gate_sub := null;
  min_rank := null;

  if boat.access_gate is not null and coalesce(boat.access_gate->>'certId', '') <> '' then
    gate_certid := boat.access_gate->>'certId';
    gate_sub := nullif(boat.access_gate->>'sub', '');
    min_rank := nullif(boat.access_gate->>'minRank', '')::numeric;
  else
    legacy_raw := nullif(boat.access_gate_cert, '');
    if legacy_raw is null then return true; end if; -- controlled mode, nothing configured yet
    -- Mirror normalizeAccessGate(): try a subcat-key match first (most
    -- legacy values are subcat keys, e.g. 'captain'), then a def-id match
    -- (flat credentials with no subcats), then fall back to matching by
    -- sub alone against any cert (memberHasGate's "legacy sub-only gate").
    select d.id into gate_certid
      from public.cert_defs d, jsonb_array_elements(coalesce(d.subcats, '[]'::jsonb)) s
      where s->>'key' = legacy_raw
      limit 1;
    if gate_certid is not null then
      gate_sub := legacy_raw;
    else
      select id into gate_certid from public.cert_defs where id = legacy_raw;
      if gate_certid is null then
        gate_sub := legacy_raw; -- unresolved: match by sub alone, any certId
      end if;
    end if;
  end if;

  select certifications into member_certs from public.members where kennitala = p_kennitala;
  member_certs := coalesce(member_certs, '[]'::jsonb);

  for c in select * from jsonb_array_elements(member_certs) loop
    -- Expired certs never satisfy a gate.
    if coalesce((c->>'expires')::boolean, false)
       and coalesce(c->>'expiresAt', '') <> ''
       and (c->>'expiresAt') < now_iso then
      continue;
    end if;

    if gate_certid is null then
      -- Unresolved legacy gate: match by sub alone, regardless of certId.
      if gate_sub is not null and coalesce(c->>'sub', '') = gate_sub then matched := true; exit; end if;
      continue;
    end if;

    if coalesce(c->>'certId', '') <> gate_certid then continue; end if;
    if min_rank is not null then
      select (s->>'rank')::numeric into cert_rank
        from public.cert_defs d, jsonb_array_elements(coalesce(d.subcats, '[]'::jsonb)) s
        where d.id = gate_certid and s->>'key' = coalesce(c->>'sub', '')
        limit 1;
      if coalesce(cert_rank, 0) >= min_rank then matched := true; exit; end if;
      continue;
    end if;
    if gate_sub is not null then
      if coalesce(c->>'sub', '') = gate_sub then matched := true; exit; end if;
      continue;
    end if;
    matched := true; exit;
  end loop;

  return matched;
end;
$$;
revoke execute on function public.member_satisfies_boat_gate_(text, uuid) from public, anon;
grant execute on function public.member_satisfies_boat_gate_(text, uuid) to authenticated;

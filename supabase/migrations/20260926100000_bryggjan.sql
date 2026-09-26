-- Bryggjan ("The Pier") — ad hoc crew/activity matching. An organizer
-- proposes a slot (sailing/rowing/kayaking/other, optionally tied to a
-- specific club boat), others join until it's full. Architecture agreed
-- with the user turn-by-turn (see chat), summarized here:
--   - Full request/approve enrollment: a qualified joiner (satisfies the
--     boat's cert gate, or the post's own required_cert when there's no
--     boat) lands straight in the roster as 'approved' — no visible
--     pending state. A non-qualifying joiner's request sits 'pending'
--     for the organizer to approve/decline by hand.
--   - Every post has a fixed max_crew (no open-ended rosters).
--   - Boat-linked posts: the organizer picks any date/time; booking is
--     attempted immediately via the EXISTING save_slot/book_slot RPCs
--     (20260921122807_slots_and_crews_domain.sql) and fails loudly on a
--     real conflict, rather than only offering already-open slots.
--   - The reservation books under the ORGANIZER's own kennitala, not via
--     book_slot's p_crew_id path — that path is hard-wired to the
--     rowing-specific `crews` table (2-seat pairs), the wrong shape for
--     an arbitrary-capacity roster. Bryggjan's own roster lives entirely
--     in bryggjan_signups; the slot's booked_by_* fields just mean "the
--     organizer has this boat reserved."
--   - The slot books as tentative=true (book_slot's plain-kennitala path
--     never sets tentative itself — that's only wired for the crew path
--     — so this migration sets it directly) and flips to tentative=false
--     automatically the moment the roster fills.
--   - Cancelling a post releases the reservation immediately (unbook_slot),
--     same as the "automatically released" answer.
--   - Only members meeting a boat's own access gate may INITIATE a post
--     for that boat (checked via the new member_satisfies_boat_gate_
--     below — the first real implementation of that check anywhere in
--     this migration; every other write path (save-checkout, book_slot's
--     plain-kennitala branch) still has it stubbed).

-- ── Real boat access-gate check (first implementation, not stubbed) ────────
-- Mirrors save_member_cert's own certDefs-rank lookup exactly, so a ranked
-- cert (access_gate.minRank set) is evaluated the same way save_member_cert
-- already resolves rank when cleaning up a member's own certifications.
create or replace function public.member_satisfies_boat_gate_(p_kennitala text, p_boat_id uuid) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  boat public.boats;
  gate jsonb;
  gate_cert text;
  gate_sub text;
  min_rank numeric;
  member_certs jsonb;
  defs jsonb;
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

  gate := boat.access_gate;
  gate_cert := coalesce(gate->>'certId', boat.access_gate_cert, '');
  if gate_cert = '' then return true; end if; -- controlled mode but no cert configured yet: nothing to gate against
  gate_sub := nullif(gate->>'sub', '');
  min_rank := nullif(gate->>'minRank', '')::numeric;

  select certifications into member_certs from public.members where kennitala = p_kennitala;
  member_certs := coalesce(member_certs, '[]'::jsonb);

  if min_rank is not null then
    select value into defs from public.app_config where key = 'certDefs';
    defs := coalesce(defs, '[]'::jsonb);
  end if;

  for c in select * from jsonb_array_elements(member_certs) loop
    if coalesce(c->>'certId', '') <> gate_cert then continue; end if;
    if gate_sub is not null and coalesce(c->>'sub', '') <> gate_sub then continue; end if;
    -- Expired certs never satisfy a gate, regardless of rank.
    if coalesce((c->>'expires')::boolean, false)
       and coalesce(c->>'expiresAt', '') <> ''
       and (c->>'expiresAt') < now_iso then
      continue;
    end if;
    if min_rank is null then
      matched := true; exit;
    end if;
    select (s->>'rank')::numeric into cert_rank
      from jsonb_array_elements(defs) d, jsonb_array_elements(coalesce(d->'subcats', '[]'::jsonb)) s
      where d->>'id' = gate_cert and s->>'key' = coalesce(c->>'sub', '')
      limit 1;
    if coalesce(cert_rank, 0) >= min_rank then matched := true; exit; end if;
  end loop;

  return matched;
end;
$$;
revoke execute on function public.member_satisfies_boat_gate_(text, uuid) from public, anon;
grant execute on function public.member_satisfies_boat_gate_(text, uuid) to authenticated;

-- ── Tables ───────────────────────────────────────────────────────────────
create table public.bryggjan_posts (
  id uuid primary key default gen_random_uuid(),
  organizer_member_id uuid not null references public.members(id),
  organizer_kennitala text not null,
  organizer_name text not null default '',
  activity_kind text not null check (activity_kind in ('sailing', 'rowing', 'kayaking', 'other')),
  boat_id uuid references public.boats(id),
  boat_name text not null default '',
  title text not null default '',
  note text not null default '',
  date date not null,
  start_time time,
  end_time time,
  max_crew int not null check (max_crew >= 1),
  required_cert text not null default '', -- only consulted when boat_id is null
  enrollment_mode text not null default 'open' check (enrollment_mode in ('open', 'contact_organizer')),
  status text not null default 'open' check (status in ('open', 'full', 'cancelled')),
  reservation_slot_id uuid references public.reservation_slots(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bryggjan_posts_date_idx on public.bryggjan_posts(date) where status <> 'cancelled';
create index bryggjan_posts_organizer_idx on public.bryggjan_posts(organizer_member_id);

create table public.bryggjan_signups (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.bryggjan_posts(id) on delete cascade,
  member_id uuid not null references public.members(id),
  kennitala text not null,
  member_name text not null default '',
  status text not null default 'pending' check (status in ('approved', 'pending', 'declined', 'withdrawn')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_kennitala text
);
-- A member can have at most one *active* (approved/pending) signup per
-- post — they can re-request after withdrawing or being declined, so
-- those statuses are excluded rather than covered by a plain unique().
create unique index bryggjan_signups_active_unique
  on public.bryggjan_signups(post_id, member_id)
  where status in ('approved', 'pending');
create index bryggjan_signups_post_idx on public.bryggjan_signups(post_id);
create index bryggjan_signups_member_idx on public.bryggjan_signups(member_id);

alter table public.bryggjan_posts enable row level security;
alter table public.bryggjan_signups enable row level security;

-- Read access mirrors the "any live session, board is visible to every
-- active member" answer — no ownership restriction on select.
create policy bryggjan_posts_select on public.bryggjan_posts
  for select to authenticated using (public.session_valid());
create policy bryggjan_signups_select on public.bryggjan_signups
  for select to authenticated using (public.session_valid());

-- All writes go through the RPCs below (security definer, doing the real
-- validation) — authenticated gets no direct table grants, matching the
-- save_trip/save_slot convention of RPC-mediated writes.
revoke all on public.bryggjan_posts from authenticated, anon;
revoke all on public.bryggjan_signups from authenticated, anon;
grant select on public.bryggjan_posts to authenticated;
grant select on public.bryggjan_signups to authenticated;

-- ── RPCs ─────────────────────────────────────────────────────────────────

create or replace function public.create_bryggjan_post(
  p_activity_kind text,
  p_date date,
  p_max_crew int,
  p_boat_id uuid default null,
  p_start_time time default null,
  p_end_time time default null,
  p_title text default '',
  p_note text default '',
  p_required_cert text default '',
  p_enrollment_mode text default 'open'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_id uuid;
  organizer_kt text;
  organizer_name text;
  boat public.boats;
  new_post_id uuid;
  new_slot_id uuid;
  save_result jsonb;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_activity_kind not in ('sailing', 'rowing', 'kayaking', 'other') then
    raise exception 'Invalid activity kind';
  end if;
  if p_date is null then raise exception 'date required'; end if;
  if p_max_crew is null or p_max_crew < 1 then raise exception 'maxCrew must be at least 1'; end if;
  if p_enrollment_mode not in ('open', 'contact_organizer') then p_enrollment_mode := 'open'; end if;

  organizer_id := public.current_member_id();
  organizer_kt := public.current_kennitala();
  select name into organizer_name from public.members where id = organizer_id;

  if p_boat_id is not null then
    select * into boat from public.boats where id = p_boat_id;
    if not found then raise exception 'Boat not found'; end if;
    if not public.member_satisfies_boat_gate_(organizer_kt, p_boat_id) then
      raise exception 'You do not meet this boat''s certification requirement';
    end if;
    if boat.slot_scheduling_enabled then
      if p_start_time is null or p_end_time is null then
        raise exception 'startTime and endTime required for a boat with slot scheduling';
      end if;
      -- save_slot raises loudly on a real conflict — "attempt to book,
      -- fail on conflict" per the chosen design, not a pre-filtered list
      -- of already-open slots.
      save_result := public.save_slot(p_boat_id, p_date, p_start_time, p_end_time);
      new_slot_id := (save_result->>'slotId')::uuid;
      perform public.book_slot(new_slot_id, organizer_kt, organizer_name);
      -- book_slot's plain-kennitala path never sets tentative itself
      -- (only the crew path does) — set it directly here so the
      -- reservation reads as provisional until the roster fills.
      update public.reservation_slots set tentative = true where id = new_slot_id;
    end if;
  end if;

  insert into public.bryggjan_posts (
    organizer_member_id, organizer_kennitala, organizer_name, activity_kind,
    boat_id, boat_name, title, note, date, start_time, end_time, max_crew,
    required_cert, enrollment_mode, reservation_slot_id
  ) values (
    organizer_id, organizer_kt, coalesce(organizer_name, ''), p_activity_kind,
    p_boat_id, coalesce(boat.name, ''), coalesce(p_title, ''), coalesce(p_note, ''),
    p_date, p_start_time, p_end_time, p_max_crew,
    coalesce(p_required_cert, ''), p_enrollment_mode, new_slot_id
  ) returning id into new_post_id;

  -- Organizer occupies the first seat, same convention as create_crew
  -- auto-seating its creator.
  insert into public.bryggjan_signups (post_id, member_id, kennitala, member_name, status, decided_at, decided_by_kennitala)
  values (new_post_id, organizer_id, organizer_kt, coalesce(organizer_name, ''), 'approved', now(), organizer_kt);

  if p_max_crew = 1 then
    update public.bryggjan_posts set status = 'full', updated_at = now() where id = new_post_id;
    if new_slot_id is not null then
      update public.reservation_slots set tentative = false where id = new_slot_id;
    end if;
  end if;

  return jsonb_build_object('created', true, 'postId', new_post_id, 'slotId', new_slot_id);
end;
$$;
revoke execute on function public.create_bryggjan_post(text, date, int, uuid, time, time, text, text, text, text) from public, anon;
grant execute on function public.create_bryggjan_post(text, date, int, uuid, time, time, text, text, text, text) to authenticated;

-- Shared by join/decide — centralizes the "roster just filled" transition
-- so both call sites can't drift: mark the post full, and firm up the
-- boat reservation (tentative -> confirmed) if it's boat-linked.
create or replace function public.bryggjan_mark_full_if_complete_(p_post_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  post public.bryggjan_posts;
  approved_count int;
begin
  select * into post from public.bryggjan_posts where id = p_post_id;
  if not found or post.status <> 'open' then return; end if;
  select count(*) into approved_count from public.bryggjan_signups
    where post_id = p_post_id and status = 'approved';
  if approved_count >= post.max_crew then
    update public.bryggjan_posts set status = 'full', updated_at = now() where id = p_post_id;
    if post.reservation_slot_id is not null then
      update public.reservation_slots set tentative = false where id = post.reservation_slot_id;
    end if;
  end if;
end;
$$;
revoke execute on function public.bryggjan_mark_full_if_complete_(uuid) from public, anon, authenticated;

create or replace function public.join_bryggjan_post(p_post_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  post public.bryggjan_posts;
  joiner_id uuid;
  joiner_kt text;
  joiner_name text;
  qualifies boolean;
  new_status text;
  new_signup_id uuid;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  select * into post from public.bryggjan_posts where id = p_post_id;
  if not found then raise exception 'Post not found'; end if;
  if post.status <> 'open' then raise exception 'This post is no longer open'; end if;
  if post.enrollment_mode <> 'open' then raise exception 'This post requires contacting the organizer directly'; end if;

  joiner_id := public.current_member_id();
  joiner_kt := public.current_kennitala();
  if exists (
    select 1 from public.bryggjan_signups
    where post_id = p_post_id and member_id = joiner_id and status in ('approved', 'pending')
  ) then
    raise exception 'You already have an active request for this post';
  end if;
  select name into joiner_name from public.members where id = joiner_id;

  if post.boat_id is not null then
    qualifies := public.member_satisfies_boat_gate_(joiner_kt, post.boat_id);
  elsif post.required_cert <> '' then
    qualifies := exists (
      select 1 from public.members m, jsonb_array_elements(coalesce(m.certifications, '[]'::jsonb)) c
      where m.kennitala = joiner_kt and c->>'certId' = post.required_cert
        and not (coalesce((c->>'expires')::boolean, false)
                 and coalesce(c->>'expiresAt', '') <> ''
                 and (c->>'expiresAt') < to_char(now(), 'YYYY-MM-DD'))
    );
  else
    qualifies := true;
  end if;

  new_status := case when qualifies then 'approved' else 'pending' end;

  insert into public.bryggjan_signups (post_id, member_id, kennitala, member_name, status, decided_at, decided_by_kennitala)
  values (p_post_id, joiner_id, joiner_kt, coalesce(joiner_name, ''), new_status,
    case when qualifies then now() else null end, case when qualifies then joiner_kt else null end)
  returning id into new_signup_id;

  if qualifies then
    perform public.bryggjan_mark_full_if_complete_(p_post_id);
  end if;

  return jsonb_build_object('joined', true, 'signupId', new_signup_id, 'status', new_status);
end;
$$;
revoke execute on function public.join_bryggjan_post(uuid) from public, anon;
grant execute on function public.join_bryggjan_post(uuid) to authenticated;

create or replace function public.decide_bryggjan_signup(p_signup_id uuid, p_approve boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signup public.bryggjan_signups;
  post public.bryggjan_posts;
  decider_kt text;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  select * into signup from public.bryggjan_signups where id = p_signup_id;
  if not found then raise exception 'Signup not found'; end if;
  if signup.status <> 'pending' then raise exception 'Signup already decided'; end if;

  select * into post from public.bryggjan_posts where id = signup.post_id;
  decider_kt := public.current_kennitala();
  if decider_kt <> post.organizer_kennitala and not public.is_staff_or_admin() then
    raise exception 'Only the organizer can decide this request' using errcode = '28000';
  end if;
  if post.status <> 'open' then raise exception 'This post is no longer open'; end if;

  update public.bryggjan_signups set
    status = case when p_approve then 'approved' else 'declined' end,
    decided_at = now(), decided_by_kennitala = decider_kt
  where id = p_signup_id;

  if p_approve then
    perform public.bryggjan_mark_full_if_complete_(signup.post_id);
  end if;

  return jsonb_build_object('decided', true, 'approved', p_approve);
end;
$$;
revoke execute on function public.decide_bryggjan_signup(uuid, boolean) from public, anon;
grant execute on function public.decide_bryggjan_signup(uuid, boolean) to authenticated;

create or replace function public.withdraw_bryggjan_signup(p_signup_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signup public.bryggjan_signups;
  post public.bryggjan_posts;
  actor_kt text;
  was_approved boolean;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  select * into signup from public.bryggjan_signups where id = p_signup_id;
  if not found then raise exception 'Signup not found'; end if;
  if signup.status not in ('approved', 'pending') then raise exception 'Nothing to withdraw'; end if;

  select * into post from public.bryggjan_posts where id = signup.post_id;
  actor_kt := public.current_kennitala();
  if actor_kt <> signup.kennitala and actor_kt <> post.organizer_kennitala and not public.is_staff_or_admin() then
    raise exception 'Not authorised' using errcode = '28000';
  end if;

  was_approved := signup.status = 'approved';
  update public.bryggjan_signups set status = 'withdrawn', decided_at = now(), decided_by_kennitala = actor_kt
  where id = p_signup_id;

  -- Reopen a seat that a full roster just lost, and un-firm the
  -- reservation — it's genuinely provisional again until refilled.
  if was_approved and post.status = 'full' then
    update public.bryggjan_posts set status = 'open', updated_at = now() where id = post.id;
    if post.reservation_slot_id is not null then
      update public.reservation_slots set tentative = true where id = post.reservation_slot_id;
    end if;
  end if;

  return jsonb_build_object('withdrawn', true);
end;
$$;
revoke execute on function public.withdraw_bryggjan_signup(uuid) from public, anon;
grant execute on function public.withdraw_bryggjan_signup(uuid) to authenticated;

create or replace function public.cancel_bryggjan_post(p_post_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  post public.bryggjan_posts;
  actor_kt text;
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  select * into post from public.bryggjan_posts where id = p_post_id;
  if not found then raise exception 'Post not found'; end if;

  actor_kt := public.current_kennitala();
  if actor_kt <> post.organizer_kennitala and not public.is_staff_or_admin() then
    raise exception 'Only the organizer can cancel this post' using errcode = '28000';
  end if;
  if post.status = 'cancelled' then return jsonb_build_object('cancelled', true); end if;

  update public.bryggjan_posts set status = 'cancelled', updated_at = now() where id = p_post_id;
  update public.bryggjan_signups set status = 'withdrawn', decided_at = now(), decided_by_kennitala = actor_kt
    where post_id = p_post_id and status in ('approved', 'pending');

  -- "Automatically released" — unbook_slot just clears booked_by_* on the
  -- slot row, leaving the window itself open for someone else to book
  -- directly, exactly the released state this is meant to produce.
  if post.reservation_slot_id is not null then
    perform public.unbook_slot(post.reservation_slot_id, post.organizer_kennitala);
  end if;

  return jsonb_build_object('cancelled', true);
end;
$$;
revoke execute on function public.cancel_bryggjan_post(uuid) from public, anon;
grant execute on function public.cancel_bryggjan_post(uuid) to authenticated;

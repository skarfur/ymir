-- Phase 0 Task #6: convert share.gs's 4 actions (getShareTokens,
-- createShareToken, revokeShareToken, deleteShareToken) from
-- one-Edge-Function-per-action to direct PostgREST + RLS. All four are
-- plain owner-scoped CRUD on a single table with no cross-row invariant
-- to protect, so no RPC wrapper is needed — RLS alone reproduces the
-- original "memberKennitala must match caller" check from share.gs,
-- and does it uniformly for every verb instead of re-checking it by
-- hand in each Edge Function.

-- id was a client/Edge-Function-generated 8-char base62 code
-- (shareUid_() in code.gs) embedded verbatim in the public share URL.
-- Moving generation server-side via a column DEFAULT means an
-- INSERT never has to send or trust a client-picked id.
create or replace function public.gen_share_id()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  chars  text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  bytes  bytea := extensions.gen_random_bytes(8);
  result text := '';
  i      int;
begin
  for i in 0..7 loop
    result := result || substr(chars, (get_byte(bytes, i) % 62) + 1, 1);
  end loop;
  return result;
end;
$$;

alter table public.share_tokens alter column id set default public.gen_share_id();

-- createShareToken_ resolved member_kennitala server-side from the
-- caller's own member row (via findOne_('members','kennitala',...)),
-- never from a client-sent value. Reproduce that with a BEFORE INSERT
-- trigger keyed off member_id (== current_member_id() per the RLS
-- check below) rather than trusting a posted member_kennitala.
create or replace function public.share_tokens_set_kennitala()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select kennitala into new.member_kennitala
    from public.members where id = new.member_id;
  return new;
end;
$$;

drop trigger if exists share_tokens_set_kennitala_trg on public.share_tokens;
create trigger share_tokens_set_kennitala_trg
  before insert on public.share_tokens
  for each row execute function public.share_tokens_set_kennitala();

-- Owner-only throughout — share.gs never had a staff/admin override for
-- these actions, so RLS doesn't add one either.
create policy share_tokens_select_own on public.share_tokens
  for select to authenticated
  using (member_id = public.current_member_id());

create policy share_tokens_insert_own on public.share_tokens
  for insert to authenticated
  with check (member_id = public.current_member_id());

-- Covers revokeShareToken_ (sets revoked_at only); RLS can't restrict
-- which columns an UPDATE touches, so client code is trusted to only
-- ever send revoked_at, same as the Edge Function was trusted to.
create policy share_tokens_update_own on public.share_tokens
  for update to authenticated
  using (member_id = public.current_member_id())
  with check (member_id = public.current_member_id());

create policy share_tokens_delete_own on public.share_tokens
  for delete to authenticated
  using (member_id = public.current_member_id());

grant select, insert, update, delete on public.share_tokens to authenticated;

-- createShareToken_ always set cutOffDate server-side to "today"
-- (ts.slice(0,10)), never from client input. A column DEFAULT reproduces
-- that without the client needing to compute or send a date.
alter table public.share_tokens alter column cut_off_date set default current_date;

-- share_tokens_set_kennitala() is a BEFORE INSERT trigger helper, not an
-- RPC endpoint — trigger firing doesn't need EXECUTE granted to the
-- invoking role, only the table owner's privilege to fire it. Revoking
-- direct EXECUTE stops it being callable via /rest/v1/rpc/ (advisor-flagged
-- anon/authenticated exposure) without touching the trigger itself.
revoke execute on function public.share_tokens_set_kennitala() from public, anon, authenticated;

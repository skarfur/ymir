-- Tracks when a member last viewed the Bryggjan board, so
-- get-notifications can count "open posts I haven't seen yet" without a
-- separate per-post read-state table -- one timestamp, same idea as any
-- "mark as read" pattern, just scoped to the whole board rather than a
-- per-item flag (a computed count, not a discrete notification row, is
-- the right shape here since "new open posts" isn't a thing to
-- individually approve/decline the way a crew invite is).
alter table public.members add column bryggjan_seen_at timestamptz;

create or replace function public.mark_bryggjan_seen() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.session_valid() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  update public.members set bryggjan_seen_at = now() where id = public.current_member_id();
end;
$$;
revoke execute on function public.mark_bryggjan_seen() from public, anon;
grant execute on function public.mark_bryggjan_seen() to authenticated;

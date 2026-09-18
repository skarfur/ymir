create table activities (
  id                        uuid primary key default gen_random_uuid(),
  signup_required           boolean not null default false,
  status                    text not null default 'upcoming',
  source                    text,
  date                      date not null,
  end_date                  date,
  start_time                time,
  end_time                  time,
  activity_type_id          uuid,
  subtype_id                uuid,
  title                     text,
  title_is                  text,
  notes                     text,
  notes_is                  text,
  participants              jsonb not null default '[]',
  leader_member_id          uuid references members(id),
  show_leader_phone         boolean not null default false,
  roles                     jsonb,
  source_activity_type_id   uuid,
  source_subtype_id         uuid,
  gcal_event_id             text,
  calendar_id               text,
  calendar_sync_active      boolean not null default false,
  daily_log_date            date,
  abler_registered          boolean,
  linked_group_checkout_ids jsonb,
  actor_id                  uuid references members(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
alter table activities enable row level security;
revoke all on activities from anon, authenticated;

create table volunteer_signups (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid references activities(id) on delete cascade,
  role_id      text,
  member_id    uuid references members(id),
  signed_up_at timestamptz not null default now()
);
alter table volunteer_signups enable row level security;
revoke all on volunteer_signups from anon, authenticated;

-- ── Audit log ───────────────────────────────────────────────────────
create table audit_log (
  id         bigserial primary key,
  table_name text not null,
  row_id     uuid,
  action     text not null check (action in ('insert','update','delete')),
  actor_id   uuid references members(id),
  diff       jsonb,
  at         timestamptz not null default now()
);
alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated;

create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into audit_log(table_name, row_id, action, diff)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    case tg_op
      when 'INSERT' then to_jsonb(new)
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      when 'DELETE' then to_jsonb(old)
    end
  );
  return coalesce(new, old);
end;
$$;
revoke execute on function audit_row_change() from public, anon, authenticated;

create trigger audit_checkouts   after insert or update or delete on checkouts   for each row execute function audit_row_change();
create trigger audit_trips       after insert or update or delete on trips       for each row execute function audit_row_change();
create trigger audit_members     after insert or update or delete on members     for each row execute function audit_row_change();
create trigger audit_maintenance after insert or update or delete on maintenance for each row execute function audit_row_change();
create trigger audit_incidents   after insert or update or delete on incidents   for each row execute function audit_row_change();

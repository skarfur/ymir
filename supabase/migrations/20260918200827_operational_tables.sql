create table checkouts (
  id                   uuid primary key default gen_random_uuid(),
  boat_id              uuid references boats(id),
  member_id            uuid references members(id),
  location_id          uuid references locations(id),
  crew                 jsonb not null default '[]',
  member_phone         text,
  member_is_minor      boolean,
  checked_out_at       timestamptz not null default now(),
  expected_return      timestamptz,
  checked_in_at        timestamptz,
  wx_snapshot          jsonb,
  pre_launch_checklist jsonb,
  after_sail_checklist jsonb,
  notes                text,
  status               text not null default 'out',
  non_club             boolean not null default false,
  departure_port       text,
  is_group             boolean not null default false,
  participants         jsonb not null default '[]',
  staff_ids            jsonb not null default '[]',
  boat_ids             jsonb not null default '[]',
  activity_type_id     uuid,
  linked_activity_id   uuid,
  alert_silenced       boolean not null default false,
  alert_silenced_by    uuid references members(id),
  alert_silenced_at    timestamptz,
  alert_snoozed_until  timestamptz,
  alert_first_sent     timestamptz,
  actor_id             uuid not null references members(id),
  created_at           timestamptz not null default now()
);
create index checkouts_member_id_idx on checkouts(member_id);
create index checkouts_boat_id_idx on checkouts(boat_id);
create index checkouts_status_idx on checkouts(status);
alter table checkouts enable row level security;
revoke all on checkouts from anon, authenticated;

create table trips (
  id                    uuid primary key default gen_random_uuid(),
  member_id             uuid references members(id),
  boat_id               uuid references boats(id),
  location_id           uuid references locations(id),
  linked_checkout_id    uuid references checkouts(id),
  date                  date not null,
  time_out              timestamptz,
  time_in               timestamptz,
  hours_decimal         numeric(6,2),
  crew                  jsonb not null default '[]',
  role                  text,
  beaufort              int,
  wind_dir              text,
  wx_snapshot           jsonb,
  notes                 text,
  is_linked             boolean not null default false,
  linked_trip_id        uuid,
  verified              boolean not null default false,
  verified_by           uuid references members(id),
  verified_at           timestamptz,
  staff_comment         text,
  validation_requested  boolean not null default false,
  helm                  text,
  student               text,
  skipper_note          text,
  non_club              boolean not null default false,
  distance_nm           numeric(8,2),
  departure_port        text,
  arrival_port          text,
  track_file_url        text,
  track_simplified      jsonb,
  track_source          text,
  photo_urls            text[] not null default '{}',
  photo_meta            jsonb,
  actor_id              uuid not null references members(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index trips_member_id_idx on trips(member_id);
create index trips_date_idx on trips(date);
alter table trips enable row level security;
revoke all on trips from anon, authenticated;

create table trip_confirmations (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null,
  status              text not null default 'pending',
  from_member_id      uuid references members(id),
  to_member_id        uuid references members(id),
  trip_id             uuid references trips(id),
  linked_checkout_id  uuid references checkouts(id),
  boat_id             uuid references boats(id),
  location_id         uuid references locations(id),
  date                date,
  time_out            timestamptz,
  time_in             timestamptz,
  hours_decimal       numeric(6,2),
  role                text,
  helm                text,
  crew                jsonb,
  skipper_note        text,
  beaufort            int,
  wind_dir            text,
  wx_snapshot         jsonb,
  reject_comment      text,
  dismissed           boolean not null default false,
  dismissed_at        timestamptz,
  created_at          timestamptz not null default now(),
  responded_at        timestamptz
);
alter table trip_confirmations enable row level security;
revoke all on trip_confirmations from anon, authenticated;

create table reservation_slots (
  id                       uuid primary key default gen_random_uuid(),
  boat_id                  uuid references boats(id),
  date                     date not null,
  start_time               time not null,
  end_time                 time not null,
  recurrence_group_id      uuid,
  booked_by_member_id      uuid references members(id),
  booked_by_crew_id        uuid,
  booking_color            text,
  note                     text,
  source_activity_class_id uuid,
  created_at               timestamptz not null default now()
);
alter table reservation_slots enable row level security;
revoke all on reservation_slots from anon, authenticated;

create table crews (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  pairs      jsonb not null default '[]',
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table crews enable row level security;
revoke all on crews from anon, authenticated;

create table crew_invites (
  id             uuid primary key default gen_random_uuid(),
  crew_id        uuid references crews(id) on delete cascade,
  pair_id        text,
  from_member_id uuid references members(id),
  to_member_id   uuid references members(id),
  status         text not null default 'pending',
  created_at     timestamptz not null default now(),
  responded_at   timestamptz
);
alter table crew_invites enable row level security;
revoke all on crew_invites from anon, authenticated;

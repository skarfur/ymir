create table daily_log (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  opening_checks jsonb,
  closing_checks jsonb,
  activities     jsonb,
  weather_log    jsonb,
  narrative      text,
  tide_data      jsonb,
  signed_off_by  uuid references members(id),
  signed_off_at  timestamptz,
  actor_id       uuid not null references members(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index daily_log_date_key on daily_log(date);
alter table daily_log enable row level security;
revoke all on daily_log from anon, authenticated;

create table incidents (
  id               uuid primary key default gen_random_uuid(),
  types            jsonb not null default '[]',
  severity         text,
  date             date not null,
  time             time,
  location_id      uuid references locations(id),
  boat_id          uuid references boats(id),
  description      text,
  involved         jsonb,
  witnesses        jsonb,
  immediate_action text,
  follow_up        text,
  hand_off_to      uuid references members(id),
  hand_off_notes   text,
  photo_urls       text[] not null default '{}',
  filed_by         uuid references members(id),
  filed_at         timestamptz not null default now(),
  resolved         boolean not null default false,
  resolved_at      timestamptz,
  staff_notes      text,
  reviewer_notes   text,
  status           text not null default 'open'
);
alter table incidents enable row level security;
revoke all on incidents from anon, authenticated;

create table maintenance (
  id           uuid primary key default gen_random_uuid(),
  category     text,
  boat_id      uuid references boats(id),
  item_name    text,
  part         text,
  severity     text,
  description  text,
  photo_url    text,
  mark_oos     boolean not null default false,
  reported_by  uuid references members(id),
  source       text,
  created_at   timestamptz not null default now(),
  resolved     boolean not null default false,
  resolved_by  uuid references members(id),
  resolved_at  timestamptz,
  comments     jsonb,
  saumaklubbur boolean not null default false,
  verkstjori   uuid references members(id),
  materials    jsonb,
  approved     boolean,
  on_hold      boolean not null default false
);
alter table maintenance enable row level security;
revoke all on maintenance from anon, authenticated;

create table passport_signoffs (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid references members(id),
  passport_id   text,
  item_id       text,
  signer_id     uuid references members(id),
  signer_role   text,
  signed_at     timestamptz not null default now(),
  note          text,
  revoked_by    uuid references members(id),
  revoked_at    timestamptz,
  revoke_reason text
);
alter table passport_signoffs enable row level security;
revoke all on passport_signoffs from anon, authenticated;

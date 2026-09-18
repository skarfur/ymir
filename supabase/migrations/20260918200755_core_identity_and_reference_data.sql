create extension if not exists pgcrypto;

-- ── Core identity ─────────────────────────────────────────────────
create table members (
  id             uuid primary key default gen_random_uuid(),
  kennitala      text not null,               -- TODO: move to pgcrypto-encrypted column once a Vault key is provisioned
  name           text not null,
  role           text not null check (role in ('member','staff','captain','coxswain','admin')),
  email          text,
  phone          text,
  birth_year     int,                          -- is_minor is computed at query time (age changes with the calendar, not the row)
  active         boolean not null default true,
  certifications jsonb not null default '[]',
  initials       text,
  preferences    jsonb not null default '{}',
  google_email   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index members_kennitala_key on members (kennitala);
alter table members enable row level security;
revoke all on members from anon, authenticated;

create table guardians (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references members(id) on delete cascade,
  name       text not null,
  kennitala  text,
  phone      text not null
);
create index guardians_member_id_idx on guardians(member_id);
alter table guardians enable row level security;
revoke all on guardians from anon, authenticated;

-- ── Sessions (ports code.gs's hashed-token model) ──────────────────
create table sessions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references members(id) on delete cascade,
  token_hash     text not null unique,
  role           text not null,
  stay_logged_in boolean not null default false,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null
);
create index sessions_member_id_idx on sessions(member_id);
create index sessions_expires_at_idx on sessions(expires_at);
alter table sessions enable row level security;
revoke all on sessions from anon, authenticated;

-- ── Reference data ──────────────────────────────────────────────────
create table boats (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  category text not null,
  active   boolean not null default true
);
alter table boats enable row level security;
revoke all on boats from anon, authenticated;

create table locations (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);
alter table locations enable row level security;
revoke all on locations from anon, authenticated;

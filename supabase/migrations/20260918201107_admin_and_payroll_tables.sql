create table app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;
revoke all on app_config from anon, authenticated;

create table employees (
  id                 uuid primary key default gen_random_uuid(),
  member_id          uuid references members(id),
  kt                 text,
  name               text not null,
  title              text,
  bank_account       text,
  orlofsreikningur   text,
  base_rate_kr       numeric(10,2),
  union_name         text,
  lifeyrir           text,
  sereignarsjodur    text,
  other_withholdings jsonb,
  active             boolean not null default true,
  start_date         date,
  payroll_enabled    boolean not null default true
);
alter table employees enable row level security;
revoke all on employees from anon, authenticated;

create table time_clock (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id),
  type             text not null,
  ts               timestamptz not null,
  source           text,
  original_ts      timestamptz,
  note             text,
  period_key       text,
  duration_minutes numeric(10,2)
);
alter table time_clock enable row level security;
revoke all on time_clock from anon, authenticated;

create table share_tokens (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid references members(id),
  cut_off_date     date,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  access_count     int not null default 0,
  last_accessed_at timestamptz,
  include_photos   boolean not null default false,
  include_tracks   boolean not null default false,
  categories       jsonb
);
alter table share_tokens enable row level security;
revoke all on share_tokens from anon, authenticated;

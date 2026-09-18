alter table reservation_slots add column gcal_event_id text;
alter table checkouts add column activity_type_name text;
alter table checkouts add column class_tag text;
alter table maintenance add column followers jsonb not null default '[]';
alter table maintenance add column updated_at timestamptz not null default now();

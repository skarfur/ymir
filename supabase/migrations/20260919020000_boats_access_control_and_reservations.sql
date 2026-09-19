-- Rethinks the Sheets-era app_config.boats JSON blob for the fields beyond
-- basic identity (id/name/category/active, already a real table). OOS +
-- access-control are boat-scoped single values — real columns on `boats`,
-- removing the split-brain where identity lived in a table but everything
-- else lived in a blob. Reservations (date-range bookings per boat) are
-- genuinely one-to-many with a member — the same shape reservation_slots
-- already has its own table for — so they get boat_reservations rather
-- than a jsonb array, avoiding the read-modify-write-the-whole-blob race
-- that pattern has (two staff editing different boats' reservations at
-- once would otherwise stomp each other).
--
-- Scoped to what checkouts.gs's saveBoatOos_/saveBoatAccess_/
-- saveReservation_/removeReservation_ + admin/boats.js's saveBoat() (via
-- the generic saveConfig action, not yet ported) actually read/write.

alter table boats add column oos boolean not null default false;
alter table boats add column oos_reason text;
alter table boats add column default_port_id uuid references locations(id);
alter table boats add column registration_no text;
alter table boats add column type_model text;
alter table boats add column loa numeric(5,2);
alter table boats add column ownership text not null default 'club' check (ownership in ('club', 'private'));
alter table boats add column owner_kennitala text;
alter table boats add column owner_name text;
alter table boats add column access_mode text not null default 'free' check (access_mode in ('free', 'controlled'));
alter table boats add column access_gate jsonb;
alter table boats add column access_gate_cert text;
alter table boats add column access_allowlist jsonb not null default '[]';
alter table boats add column slot_scheduling_enabled boolean not null default false;
alter table boats add column available_outside_slots boolean not null default true;

create table boat_reservations (
  id               uuid primary key default gen_random_uuid(),
  boat_id          uuid not null references boats(id) on delete cascade,
  member_id        uuid references members(id),
  member_kennitala text not null,
  member_name      text not null,
  start_date       date not null,
  end_date         date not null,
  note             text,
  created_at       timestamptz not null default now()
);
create index boat_reservations_boat_id_idx on boat_reservations(boat_id);
create index boat_reservations_member_id_idx on boat_reservations(member_id);
alter table boat_reservations enable row level security;
revoke all on boat_reservations from anon, authenticated;

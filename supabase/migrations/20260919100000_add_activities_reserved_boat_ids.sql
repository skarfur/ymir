-- saveVolunteerEvent_ always writes reservedBoatIds (boats blocked out for
-- the event) alongside roles, but the activities table only ever grew a
-- `roles` jsonb column — reservedBoatIds was never added.
alter table activities add column reserved_boat_ids jsonb not null default '[]'::jsonb;

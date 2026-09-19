alter table reservation_slots add column booked_by_kennitala text;
alter table reservation_slots add column booked_by_name text;
alter table reservation_slots add column tentative boolean not null default false;

-- Group-checkout write port (saveGroupCheckout_/groupCheckIn_ in
-- checkouts.gs) needs a few more checkouts columns, plus trips gets the
-- same denormalized-fields treatment checkouts already got — the
-- supervisor trips groupCheckIn creates need to round-trip through
-- get-trips exactly like a regular saveTrip_ row would.

alter table checkouts add column boat_names jsonb not null default '[]';
alter table checkouts add column staff_names jsonb not null default '[]';
alter table checkouts add column staff_kennitalar jsonb not null default '[]';
alter table checkouts add column participants_count int not null default 0;

comment on column checkouts.staff_ids is 'Unused by the write port — see staff_kennitalar for the kennitala-string list group checkouts actually store. Reserved for a future real-FK staff list.';
comment on column checkouts.participants is 'Unused by the write port — see participants_count for the Sheets-era headcount. Reserved for a future structured participant list.';

alter table trips add column member_kennitala text;
alter table trips add column member_name text;
alter table trips add column boat_name text;
alter table trips add column boat_category text;
alter table trips add column location_name text;
alter table trips add column crew_count int not null default 1;

comment on column trips.crew is 'Unused by the write port — crew_count holds the Sheets-era headcount here, matching checkouts.crew_count.';

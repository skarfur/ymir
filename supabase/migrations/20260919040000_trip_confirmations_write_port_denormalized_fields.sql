-- trip_confirmations write port (createConfirmation_/respondConfirmation_/
-- requestVerification_/dismissConfirmation_/dismissAllConfirmations_ in
-- trips.gs) needs the same denormalized-fields treatment checkouts/trips
-- already got. Two things the original operational_tables migration
-- missed, since trip_confirmations was ported read-only first without a
-- write path to exercise it against:
--
-- 1. from_member_id/to_member_id-only can't represent requestVerification_'s
--    toKennitala:'staff' sentinel (a literal marker meaning "any staff",
--    not a real member) — needs a text column, not just an FK.
-- 2. boat_name/boat_category/location_name were never added, even though
--    ensureConfirmationCols_ in the original explicitly lists them
--    alongside boatId/locationId as separate fields.
alter table trip_confirmations add column from_kennitala text;
alter table trip_confirmations add column from_name text;
alter table trip_confirmations add column to_kennitala text;
alter table trip_confirmations add column to_name text;
alter table trip_confirmations add column boat_name text;
alter table trip_confirmations add column boat_category text;
alter table trip_confirmations add column location_name text;
alter table trip_confirmations add column crew_count int not null default 1;

comment on column trip_confirmations.crew is 'Unused by the write port — crew_count holds the Sheets-era headcount, matching checkouts.crew_count/trips.crew_count.';

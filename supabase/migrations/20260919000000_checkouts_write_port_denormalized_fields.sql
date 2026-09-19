-- Sheets' saveCheckout_/checkIn_/deleteCheckout_ operate on a flat row shape
-- (memberKennitala, memberName, boatName, boatCategory, locationName, crew
-- as a headcount) that the frontend (staff.js, member.js, boats.js,
-- tripcard.js) reads directly, independent of the boat_id/location_id/
-- member_id FKs this schema already has. boat_name/location_name in
-- particular also cover the nonClub (BYO boat) case, which has no boats/
-- locations row to join against at all. Denormalize alongside the FKs
-- (which stay best-effort — boats/locations are still empty tables) rather
-- than making checkout writes depend on reference data that doesn't exist
-- yet.
alter table checkouts add column member_kennitala text;
alter table checkouts add column member_name text;
alter table checkouts add column boat_name text;
alter table checkouts add column boat_category text;
alter table checkouts add column location_name text;
alter table checkouts add column crew_count int not null default 1;

comment on column checkouts.crew is 'Named crew list (array of {name, kennitala, guest}), not a headcount — see crew_count for the headcount field the Sheets version called "crew".';

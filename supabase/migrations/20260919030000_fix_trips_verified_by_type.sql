-- trips.verified_by was declared as `uuid references members(id)` in the
-- original operational_tables migration, but the actual write path
-- (staff/staff_logbook-review.js's verify/unverify flow) sends a free-text
-- display name (`verifiedBy: user.name`), not a member id — discovered
-- while porting saveTrip_. Table is empty, so a plain type change is safe.
alter table trips drop column verified_by;
alter table trips add column verified_by text;

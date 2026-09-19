-- incidents.filed_by and hand_off_to were declared as uuid FKs, but
-- incidents.js/member.js send filedBy: user.name (a free-text display
-- name) and handOffTo: a fixed enum string ('emergency'/'hospital'/
-- 'coastguard'/'police'/'') — neither is a member id. Same wrong-FK-type
-- bug as trips.verified_by / maintenance.reported_by,verkstjori /
-- daily_log.signed_off_by. involved and witnesses were declared jsonb
-- but are plain trimmed textarea strings, not JSON. location_name and
-- boat_name were missing entirely even though createIncident_ always
-- writes them alongside location_id/boat_id.
alter table incidents drop column filed_by;
alter table incidents add column filed_by text;
alter table incidents drop column hand_off_to;
alter table incidents add column hand_off_to text;
alter table incidents drop column involved;
alter table incidents add column involved text;
alter table incidents drop column witnesses;
alter table incidents add column witnesses text;
alter table incidents add column location_name text;
alter table incidents add column boat_name text;

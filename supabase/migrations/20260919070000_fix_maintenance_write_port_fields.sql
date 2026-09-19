-- reported_by/verkstjori were declared as member_id FKs in the original
-- log_tables migration, but the actual write paths (member/member.js,
-- saumaklubbur/saumaklubbur.js, maintenance/maintenance.js) send free-text
-- display names (reportedBy: user.name, verkstjori: <free-text input>),
-- not member ids — the same verified_by-type bug found while porting
-- trips. Table is empty, so a plain type change is safe. boat_name was
-- missing entirely (Sheets stores it directly alongside boat_id).
alter table maintenance drop column reported_by;
alter table maintenance add column reported_by text;
alter table maintenance drop column verkstjori;
alter table maintenance add column verkstjori text;
alter table maintenance add column boat_name text;

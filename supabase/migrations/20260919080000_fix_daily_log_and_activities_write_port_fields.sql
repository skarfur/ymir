-- daily_log.signed_off_by was declared as a member_id FK, but
-- dailylog/dailylog.js sends signedOffBy: user.name (a display name) —
-- the same verified_by-type bug found in trips/maintenance. updated_by
-- was missing entirely even though saveDailyLog_ always writes it.
alter table daily_log drop column signed_off_by;
alter table daily_log add column signed_off_by text;
alter table daily_log add column updated_by text;

-- activities gaps found while porting saveDailyLog_'s
-- persistDailyLogActivities_ — fields the original activity_upsert_ writes
-- that the initial scheduling_and_audit migration didn't carry over.
alter table activities add column subtype_name text;
alter table activities add column leader_name text;
alter table activities add column leader_phone text;
alter table activities add column run_notes text;
alter table activities add column edited_by text;
alter table activities add column edited_at timestamptz;

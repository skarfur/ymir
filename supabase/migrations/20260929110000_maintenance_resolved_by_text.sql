-- maintenance.resolved_by was declared as a members(id) uuid FK in
-- log_tables, but every resolve path (shared/maintenance.js,
-- maintenance/maintenance.js, the daily-log checkbox) sends a display name,
-- and resolve-maintenance writes it straight in. Postgres rejected every
-- resolve ("invalid input syntax for type uuid"), so resolving from the
-- detail modal silently did nothing. Same fix as reported_by/verkstjori in
-- 20260919070000: make it free text. Existing member ids are converted to
-- the member's name so "Resolved by" still reads correctly.
alter table public.maintenance add column resolved_by_name text;
update public.maintenance mt
   set resolved_by_name = m.name
  from public.members m
 where mt.resolved_by = m.id;
alter table public.maintenance drop column resolved_by;
alter table public.maintenance rename column resolved_by_name to resolved_by;

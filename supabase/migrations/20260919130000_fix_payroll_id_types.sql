-- employees.id and time_clock.id were declared uuid with gen_random_uuid()
-- defaults, but neither side of the original app ever generates a real
-- UUID for these: seedEmployees_/uid_() produces a 16-char hex string,
-- admin/payroll/payroll.js's prSaveEmployee mints new employee ids as
-- 'emp_' + Date.now().toString(36), and adminAddTime_ mints time-clock
-- ids as 'entry_' + Date.now() + '_' + random. A uuid column can't hold
-- any of those. Same "declared uuid, actually an app-generated string"
-- bug as share_tokens.id — just on two tables this time, linked by an
-- FK that has to be dropped and recreated around the type change.
alter table time_clock drop constraint time_clock_employee_id_fkey;

alter table employees alter column id drop default;
alter table employees alter column id type text using id::text;

alter table time_clock alter column id drop default;
alter table time_clock alter column id type text using id::text;
alter table time_clock alter column employee_id type text using employee_id::text;

alter table time_clock add constraint time_clock_employee_id_fkey
  foreign key (employee_id) references employees(id);

alter table crews add column description text not null default '';
alter table crews add column visibility text not null default 'open' check (visibility in ('open', 'invite_only'));
alter table crews add column color text not null default '';

alter table crew_invites add column crew_name text;
alter table crew_invites add column from_kennitala text;
alter table crew_invites add column from_name text;
alter table crew_invites add column to_kennitala text;
alter table crew_invites add column to_name text;

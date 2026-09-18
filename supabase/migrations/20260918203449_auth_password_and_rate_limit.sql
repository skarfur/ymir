alter table members add column password_hash text;
alter table members add column password_is_temp boolean not null default false;

create table login_attempts (
  kennitala    text primary key,
  attempts     int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table login_attempts enable row level security;
revoke all on login_attempts from anon, authenticated;

-- Verifies a password against the stored bcrypt hash. Runs inside Postgres
-- (via pgcrypto) so the Edge Function never has to touch raw password
-- comparison logic itself — only service_role may call this.
create or replace function verify_member_password(p_kennitala text, p_password text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public, extensions
as $$
  select coalesce(
    (select password_hash = extensions.crypt(p_password, password_hash)
     from members
     where kennitala = p_kennitala and password_hash is not null),
    false
  );
$$;
revoke execute on function verify_member_password(text, text) from public, anon, authenticated;
grant execute on function verify_member_password(text, text) to service_role;

-- Sets/rotates a member's password (bcrypt, cost factor 10). Used for the
-- initial temp-password issuance and any future reset flow.
create or replace function set_member_password(p_kennitala text, p_password text, p_temp boolean default false)
returns void
language sql
security definer
set search_path = pg_catalog, public, extensions
as $$
  update members
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      password_is_temp = p_temp,
      updated_at = now()
  where kennitala = p_kennitala;
$$;
revoke execute on function set_member_password(text, text, boolean) from public, anon, authenticated;
grant execute on function set_member_password(text, text, boolean) to service_role;

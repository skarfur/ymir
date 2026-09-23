-- Emails a notification whenever a trip photo gets newly marked "shared
-- with the club" (trips.photo_meta's per-URL `shared` flag going from
-- false/absent to true). Fires from a trigger on public.trips rather than
-- at Storage-upload time, since photo_meta is the one authoritative place
-- that flag actually lives — set at save_trip time in every upload flow,
-- and the trigger stays correct even if a future feature adds a way to
-- toggle sharing after the fact.
--
-- The trigger calls the notify-shared-photos Edge Function via pg_net
-- (async, best-effort — never blocks or fails the trip save). It
-- authenticates to that function with a shared secret stored in Supabase
-- Vault (never in a migration file / git), which must also be set as the
-- TRIGGER_SHARED_SECRET Edge Function secret so notify-shared-photos can
-- verify the call actually came from this trigger and not an arbitrary
-- POST to its public URL. This is a reusable convention, not specific to
-- this one feature — any future Postgres-trigger-to-Edge-Function call
-- should reuse the same 'trigger_shared_secret' Vault entry rather than
-- minting its own.

create extension if not exists pg_net;

-- Recipient address, admin-editable (Flags tab) rather than baked into a
-- secret, since it's expected to be edited from the UI, not redeployed.
create or replace function public.save_config_value(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '28000';
  end if;
  if p_key not in ('flagConfig', 'launchChecklists', 'boatCategories', 'certCategories', 'allowBreaks', 'clubCalendars', 'overdueAlerts', 'sharedPhotoEmailTo') then
    raise exception 'Unsupported config key: %', p_key;
  end if;
  insert into public.app_config (key, value, updated_at) values (p_key, p_value, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('saved', true);
end;
$$;

create or replace function public.trips_notify_shared_photos() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_meta jsonb := coalesce(NEW.photo_meta, '{}'::jsonb);
  old_meta jsonb := coalesce(OLD.photo_meta, '{}'::jsonb);
  secret text;
begin
  -- Only fire if at least one URL is newly shared (wasn't shared before) —
  -- covers both a brand-new trip saved with photos already marked shared
  -- (OLD is null on insert, old_meta coalesces to '{}') and an edit that
  -- flips the flag on an existing photo.
  if not exists (
    select 1 from jsonb_each(new_meta) as n(url, meta)
    where (n.meta->>'shared')::boolean is true
      and coalesce((old_meta -> n.url ->> 'shared')::boolean, false) is false
  ) then
    return NEW;
  end if;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'trigger_shared_secret';
  if secret is null then
    return NEW; -- not configured yet; never block the trip save on this
  end if;

  perform net.http_post(
    url := 'https://jilmxhonqhbvieyknyen.supabase.co/functions/v1/notify-shared-photos',
    body := jsonb_build_object('record', to_jsonb(NEW), 'old_record', to_jsonb(OLD)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-trigger-secret', secret),
    timeout_milliseconds := 5000
  );
  return NEW;
end;
$$;

drop trigger if exists trips_notify_shared_photos_trg on public.trips;
create trigger trips_notify_shared_photos_trg
  after insert or update of photo_meta on public.trips
  for each row execute function public.trips_notify_shared_photos();

revoke execute on function public.trips_notify_shared_photos() from public, anon, authenticated;

-- Trip file uploads (GPS tracks + photos) move from Google Drive
-- (trips.gs's uploadTripFile_/deleteTripFile_, via Apps Script's implicit-
-- OAuth DriveApp) to a Supabase Storage bucket. Uploads/deletes go
-- straight from the client using its own self-signed JWT (accessToken) —
-- same pattern as callPostgrestTable/callSupabaseRpc in shared/api.js —
-- no Edge Function in the loop for the file bytes themselves. Object
-- naming and GPX/KML parsing/simplification move client-side too (see
-- shared/logbook-upload.js); save_trip's own p_updates already accepts
-- trackFileUrl/trackSimplified/trackSource/photoUrls/photoMeta, so
-- persisting the resulting URL onto a trip is just an ordinary save_trip
-- call — no new RPC needed for that part.
--
-- Trust boundary matches save_trip/delete_trip exactly: any live session
-- (session_valid()), not owner-scoped. save_trip already lets any
-- authenticated session rewrite any trip's fields, including these same
-- URL columns, so a stricter per-owner check on the underlying storage
-- object alone wouldn't add real protection — it would just be a
-- different, inconsistent boundary from the rest of this migration's
-- already-accepted trust model for trips.

insert into storage.buckets (id, name, public)
values ('trip-files', 'trip-files', true)
on conflict (id) do nothing;

create policy trip_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trip-files' and public.session_valid());

create policy trip_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'trip-files' and public.session_valid());

-- The bucket's own `public` flag already serves objects anonymously via
-- /storage/v1/object/public/... regardless of RLS (matching the old
-- Drive "anyone with the link" sharing) — this SELECT policy only covers
-- the authenticated Storage API (list/get by path), not that public URL.
create policy trip_files_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'trip-files');

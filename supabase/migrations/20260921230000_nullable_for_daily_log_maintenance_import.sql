-- Historical Sheets rows for daily_log/maintenance have no equivalent
-- live-session value for these columns (they're always populated by the
-- active session/RPC on a live write, per code.gs / save-daily-log /
-- save-maintenance-item). Loosen NOT NULL so the historical import can
-- proceed without fabricating values.
alter table public.daily_log alter column actor_id drop not null;
alter table public.maintenance alter column on_hold drop not null;
alter table public.maintenance alter column saumaklubbur drop not null;
alter table public.maintenance alter column updated_at drop not null;

-- saveAlertConfig_ (code.gs's own admin-only, ADMIN_ACTIONS_-gated action)
-- writes the same "client resends the full value" shape as every other
-- key already on save_config_value's whitelist — admin/alerts.js always
-- builds the complete overdueAlerts object, never a partial patch, so
-- the original's field-by-field merge in saveAlertConfig_ is
-- behaviorally equivalent to a plain replace for this real caller.
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
  if p_key not in ('flagConfig', 'launchChecklists', 'boatCategories', 'certCategories', 'allowBreaks', 'clubCalendars', 'overdueAlerts') then
    raise exception 'Unsupported config key: %', p_key;
  end if;
  insert into public.app_config (key, value, updated_at) values (p_key, p_value, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('saved', true);
end;
$$;

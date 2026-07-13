-- Manager Mode one-time scheduled send control.
-- Adds a single admin RPC that toggles Manager Mode check-ins and, when a
-- future timestamp is provided, schedules a one-time pg_cron job that invokes
-- the existing weekly-checkin-run Edge Function with the stored cron secret.

alter table public.site_settings
  add column if not exists checkin_one_time_send_at  timestamptz,
  add column if not exists checkin_one_time_status   text,
  add column if not exists checkin_one_time_scheduled_at timestamptz,
  add column if not exists checkin_one_time_triggered_at timestamptz;

create or replace function public.admin_set_manager_mode_checkins(p_enabled boolean, p_run_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_result jsonb;
  v_jobname text := 'weekly-checkins-one-time';
  v_schedule text;
  v_command text := $cron$
select net.http_post(
  url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/weekly-checkin-run',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body    := jsonb_build_object('secret', (select value from public.app_secrets where key='checkin_cron_secret')),
  timeout_milliseconds := 280000
);
update public.site_settings
   set checkin_one_time_status = 'triggered',
       checkin_one_time_triggered_at = now(),
       updated_at = now()
 where id = 1;
select cron.unschedule('weekly-checkins-one-time')
 where exists (select 1 from cron.job where jobname = 'weekly-checkins-one-time');
$cron$;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;

  select to_jsonb(s) into v_old from public.site_settings s where id = 1;

  if exists (select 1 from cron.job where jobname = v_jobname) then
    perform cron.unschedule(v_jobname);
  end if;

  if p_enabled and p_run_at is not null then
    if p_run_at <= now() + interval '1 minute' then
      raise exception 'scheduled time must be at least 1 minute in the future';
    end if;

    v_schedule := format('%s %s %s %s *',
      extract(minute from p_run_at at time zone 'UTC')::int,
      extract(hour from p_run_at at time zone 'UTC')::int,
      extract(day from p_run_at at time zone 'UTC')::int,
      extract(month from p_run_at at time zone 'UTC')::int
    );
    perform cron.schedule(v_jobname, v_schedule, v_command);

    update public.site_settings
       set checkin_enabled = true,
           checkin_paused = false,
           checkin_one_time_send_at = p_run_at,
           checkin_one_time_status = 'scheduled',
           checkin_one_time_scheduled_at = now(),
           checkin_one_time_triggered_at = null,
           updated_at = now()
     where id = 1;
  elsif p_enabled then
    update public.site_settings
       set checkin_enabled = true,
           checkin_paused = false,
           checkin_one_time_send_at = null,
           checkin_one_time_status = null,
           checkin_one_time_scheduled_at = null,
           checkin_one_time_triggered_at = null,
           updated_at = now()
     where id = 1;
  else
    update public.site_settings
       set checkin_enabled = false,
           checkin_paused = false,
           checkin_one_time_send_at = null,
           checkin_one_time_status = case when checkin_one_time_status = 'scheduled' then 'cancelled' else checkin_one_time_status end,
           updated_at = now()
     where id = 1;
  end if;

  perform public._audit(
    'set_manager_mode_checkins',
    'site_settings',
    '1',
    v_old,
    jsonb_build_object('checkin_enabled', p_enabled, 'checkin_one_time_send_at', p_run_at),
    null
  );

  select to_jsonb(s) into v_result from public.site_settings s where id = 1;
  return v_result;
end; $$;

grant execute on function public.admin_set_manager_mode_checkins(boolean,timestamptz) to authenticated;

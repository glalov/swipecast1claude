-- Applied 2026-10-24 (migration reports_alert_trigger).
-- Email the team whenever someone files a report (edge fn report-alert).
insert into public.app_secrets(key, value)
values ('report_alert_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public._reports_alert_after_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/report-alert',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object(
      'secret', (select value from public.app_secrets where key = 'report_alert_secret'),
      'report_id', new.id),
    timeout_milliseconds := 20000);
  return new;
exception when others then
  -- never block a report from being saved because the alert could not be queued
  raise warning 'report alert not queued: %', sqlerrm;
  return new;
end $function$;

revoke all on function public._reports_alert_after_insert() from public, anon, authenticated;

drop trigger if exists reports_alert_after_insert on public.reports;
create trigger reports_alert_after_insert
after insert on public.reports
for each row execute function public._reports_alert_after_insert();

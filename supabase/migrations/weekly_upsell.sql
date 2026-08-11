-- ════════════════════════════════════════════════════════════════════════
--  weekly_upsell — schema + cron for the WEEKLY "what you're missing" upsell
--  to NON-PREMIUM talent only. Pairs with the edge function `weekly-upsell`.
--
--  Idempotent — safe to re-run. Deploy the edge function BEFORE the cron fires.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Toggle + emergency pause (default ON)
alter table public.site_settings
  add column if not exists weekly_upsell_enabled boolean not null default true,
  add column if not exists weekly_upsell_paused  boolean not null default false;
update public.site_settings set weekly_upsell_enabled=true, weekly_upsell_paused=false where id=1;

-- 2. Dedicated per-user opt-out (does NOT affect the daily digest or premium-upsell)
alter table public.email_preferences
  add column if not exists weekly_upsell_optout boolean not null default false;

-- 3. Send log
create table if not exists public.weekly_upsell_logs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,
  email               text,
  status              text not null default 'sent' check (status in ('sent','failed','skipped')),
  reason              text,
  provider_message_id text,
  error_message       text,
  sent_at             timestamptz not null default now()
);
create index if not exists weekly_upsell_logs_sent_at_idx on public.weekly_upsell_logs (sent_at desc);
create index if not exists weekly_upsell_logs_status_idx  on public.weekly_upsell_logs (status);
alter table public.weekly_upsell_logs enable row level security;
drop policy if exists "weekly_upsell_logs: admin select" on public.weekly_upsell_logs;
create policy "weekly_upsell_logs: admin select" on public.weekly_upsell_logs for select using (public.is_admin());

-- 4. Per-user application aggregates: latest applied casting + 7-day submission count.
create or replace function public.weekly_upsell_user_apps(uids uuid[])
returns table(talent_id uuid, latest_casting_id uuid, apps_7d bigint)
language sql security definer set search_path = public as $$
  select a.talent_id,
         (select a2.casting_id from applications a2 where a2.talent_id = a.talent_id order by a2.created_at desc limit 1) as latest_casting_id,
         count(*) filter (where a.created_at >= now() - interval '7 days') as apps_7d
  from applications a
  where a.talent_id = any(uids)
  group by a.talent_id;
$$;

-- 5. RANDOMIZED WEEKLY CADENCE — a different day + time each week (not a fixed cron).
--    An hourly dispatcher checks a stored `weekly_upsell_next_run_at`; when due it
--    fires the send, then rolls a NEW random slot ~1 week out. Cron auth: project ANON
--    key at the JWT gate; the function authorizes on the admin secret in the body.
--    Replace <PLACEHOLDER>s with the real values when running this file by hand.

alter table public.site_settings
  add column if not exists weekly_upsell_next_run_at timestamptz;

-- Seed the first send (e.g. tomorrow at a random daytime hour). Adjust as needed.
update public.site_settings
   set weekly_upsell_next_run_at =
       date_trunc('day', now() at time zone 'UTC') + interval '1 day'
       + ((14 + floor(random()*9))::int) * interval '1 hour'   -- 14:00–22:00 UTC = 10 AM–6 PM NY
 where id = 1;

create or replace function public.run_weekly_upsell_if_due()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean; v_paused boolean; v_next timestamptz;
begin
  select weekly_upsell_enabled, weekly_upsell_paused, weekly_upsell_next_run_at
    into v_enabled, v_paused, v_next
    from public.site_settings where id = 1;
  if v_enabled is distinct from true then return; end if;
  if v_paused is true then return; end if;
  if v_next is null or now() < v_next then return; end if;

  -- Reschedule FIRST (random 6–8 days out, random hour 14:00–22:00 UTC) so a slow send
  -- can never double-fire on the next hourly tick.
  update public.site_settings
     set weekly_upsell_next_run_at =
         date_trunc('day', now() at time zone 'UTC')
         + ((6 + floor(random()*3))::int) * interval '1 day'
         + ((14 + floor(random()*9))::int) * interval '1 hour'
   where id = 1;

  perform net.http_post(
    url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/weekly-upsell',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <PROJECT_ANON_KEY>'),
    body    := jsonb_build_object('action','run','secret','<ADMIN_CAMPAIGN_SECRET>'),
    timeout_milliseconds := 150000
  );
end; $$;

select cron.unschedule('weekly-upsell-tue')      where exists (select 1 from cron.job where jobname='weekly-upsell-tue');
select cron.unschedule('weekly-upsell-dispatch') where exists (select 1 from cron.job where jobname='weekly-upsell-dispatch');
select cron.schedule('weekly-upsell-dispatch', '0 * * * *', $$ select public.run_weekly_upsell_if_due(); $$);

-- Verify:  select weekly_upsell_next_run_at from site_settings where id=1;
--          select jobname, schedule, active from cron.job where jobname='weekly-upsell-dispatch';

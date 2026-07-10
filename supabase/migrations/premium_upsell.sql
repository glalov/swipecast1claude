-- ════════════════════════════════════════════════════════════════════════
--  premium_upsell — schema + cron for the twice-daily "castings + go Premium"
--  campaign to NON-PREMIUM talent only.
--
--  Run this whole file ONCE in the Supabase SQL editor (or via CLI migration).
--  It is idempotent — safe to re-run.
--
--  Pairs with the edge function `premium-upsell`. Deploy that function BEFORE
--  the cron jobs below start firing.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Send log (one row per recipient per run, tagged with the slot) ──────
create table if not exists public.premium_upsell_logs (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        references auth.users(id) on delete cascade,
  email               text,
  slot                text        not null default 'noon'
                                  check (slot in ('noon','evening')),
  status              text        not null default 'sent'
                                  check (status in ('sent','failed','skipped')),
  reason              text,
  provider_message_id text,
  error_message       text,
  sent_at             timestamptz not null default now()
);

create index if not exists premium_upsell_logs_sent_at_idx on public.premium_upsell_logs (sent_at desc);
create index if not exists premium_upsell_logs_slot_idx    on public.premium_upsell_logs (slot, sent_at desc);
create index if not exists premium_upsell_logs_status_idx  on public.premium_upsell_logs (status);

alter table public.premium_upsell_logs enable row level security;

-- Admins read all logs (mirrors email_digest_logs policy).
drop policy if exists "premium_upsell_logs: admin select" on public.premium_upsell_logs;
create policy "premium_upsell_logs: admin select"
  on public.premium_upsell_logs for select using (public.is_admin());

-- ── 2. Admin on/off toggle + emergency pause (default ON) ──────────────────
alter table public.site_settings
  add column if not exists premium_upsell_enabled boolean not null default true,
  add column if not exists premium_upsell_paused  boolean not null default false;

-- Make sure the singleton row reflects "on" now.
update public.site_settings
   set premium_upsell_enabled = true,
       premium_upsell_paused  = false
 where id = 1;

-- ── 3. Per-user opt-out for THIS campaign only ─────────────────────────────
--    Distinct from the casting-digest unsubscribe, so leaving this campaign
--    does NOT stop a user's daily casting digest.
alter table public.email_preferences
  add column if not exists premium_upsell_optout boolean not null default false;

-- ════════════════════════════════════════════════════════════════════════
--  4. CRON — twice daily via pg_cron + pg_net (already enabled on this project).
--
--  AS DEPLOYED: the cron authenticates with the project ANON key at the platform
--  JWT gate, and the function authorizes itself on the admin secret passed in the
--  body (ADMIN_CAMPAIGN_SECRET). No Vault / service-role key needed.
--  NOTE: do NOT `create extension pg_cron/pg_net` here — they're already installed
--  and re-running the create trips an after-create privilege script.
--
--  Times are UTC. New York is UTC-4 in summer (EDT):
--    16:00 UTC = 12:00 noon NY   |   22:00 UTC = 6:00 PM NY
--  (In winter/EST these shift to 11:00 AM / 5:00 PM NY — adjust if desired.)
-- ════════════════════════════════════════════════════════════════════════

-- Helper: fire the edge function for one slot.
create or replace function public.run_premium_upsell(p_slot text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/premium-upsell',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <PROJECT_ANON_KEY>'
               ),
    body    := jsonb_build_object('action','run','slot',p_slot,'secret','<ADMIN_CAMPAIGN_SECRET>'),
    timeout_milliseconds := 120000
  );
end; $$;

-- Unschedule any prior versions so re-running this file doesn't duplicate jobs.
select cron.unschedule('premium-upsell-noon')    where exists (select 1 from cron.job where jobname = 'premium-upsell-noon');
select cron.unschedule('premium-upsell-evening') where exists (select 1 from cron.job where jobname = 'premium-upsell-evening');

-- Noon NY (16:00 UTC)
select cron.schedule('premium-upsell-noon',    '0 16 * * *', $$ select public.run_premium_upsell('noon'); $$);
-- Evening NY (22:00 UTC)
select cron.schedule('premium-upsell-evening', '0 22 * * *', $$ select public.run_premium_upsell('evening'); $$);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname like 'premium-upsell-%';

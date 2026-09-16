-- Engagement-based sending for the premium upsell (2026-09-15).
--
-- WHY. The upsell mailed every non-premium actor twice a day: 33,701 sends in
-- August, two-thirds of the month's Resend allowance, and 65% of it went to
-- people who had not signed in for 30+ days. Nothing recorded whether any of it
-- was ever opened -- premium_upsell_logs stops at "sent", and resend-webhook
-- only handled bounces and complaints -- so there was no way to tell a reader
-- from a dead address, and no way to stop paying for the dead ones.
--
-- WHAT THIS ADDS.
--   1. email_engagement_events -- raw opened/clicked/delivered events from Resend.
--   2. email_engagement        -- one row per user: last open, last click, tier.
--   3. recompute_email_tiers() -- nightly, sorts everyone into a tier by itself.
--   4. get_email_tier_counts() -- read-only summary for the admin page.
--
-- Tiers decide how often a person is mailed. The send function reads the tier;
-- nothing here deletes an account or a profile, and 'paused' is reversible the
-- moment someone opens an email again.
--
--   warm    both slots      opened/clicked <=30d, OR signed in <=7d, OR joined <=14d
--   cooling morning only    any sign-in or open <=60d, or no data yet
--   cold    weekly morning  last sign-in or open 60-90d ago
--   paused  nothing         no open, no click, no sign-in for 90d+
--
-- BOOTSTRAP SAFETY. Open tracking starts empty, so for the first 14 days of
-- collected event data the function refuses to demote anyone past 'cooling'.
-- Nobody is paused on the strength of the sign-in column alone -- last_sign_in_at
-- only moves on a fresh sign-in, so a user with a live session looks dormant
-- when they are not. The floor lifts on its own once there are 14 days of
-- events; there is no switch to flip.

-- ── 1. Raw events ──────────────────────────────────────────────────────────
create table if not exists public.email_engagement_events (
  id                  bigserial primary key,
  email               text not null,
  user_id             uuid references auth.users(id) on delete set null,
  event_type          text not null check (event_type in ('delivered','opened','clicked')),
  -- Resend's message id. premium_upsell_logs already stores this per send, so
  -- an event can be traced back to the exact campaign run that earned it.
  provider_message_id text,
  campaign            text,
  slot                text,
  url                 text,
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists eee_email_type_idx   on public.email_engagement_events (lower(email), event_type, occurred_at desc);
create index if not exists eee_user_idx         on public.email_engagement_events (user_id, occurred_at desc);
create index if not exists eee_msg_idx          on public.email_engagement_events (provider_message_id);
create index if not exists eee_occurred_idx     on public.email_engagement_events (occurred_at);

alter table public.email_engagement_events enable row level security;
-- No policies: service-role writes only (the webhook). Readable via the
-- security-definer functions below, never directly by a client.

-- ── 2. Per-user rollup + tier ──────────────────────────────────────────────
create table if not exists public.email_engagement (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email            text,
  last_open_at     timestamptz,
  last_click_at    timestamptz,
  open_count       int not null default 0,
  click_count      int not null default 0,
  -- snapshot taken at recompute time, so the send path never touches auth.users
  last_sign_in_at  timestamptz,
  tier             text not null default 'cooling' check (tier in ('warm','cooling','cold','paused')),
  tier_reason      text,
  tier_updated_at  timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists ee_tier_idx on public.email_engagement (tier);

alter table public.email_engagement enable row level security;

-- ── 3. Event ingestion ─────────────────────────────────────────────────────
-- Called by resend-webhook. Resolves the address to a user, records the raw
-- event, and rolls it into email_engagement in one hop so the webhook stays a
-- single round trip. An open from someone in a demoted tier lifts them straight
-- back to 'warm' here, without waiting for the nightly pass -- re-engagement
-- should be instant, and this is the whole point of tracking it.
create or replace function public.record_email_engagement(
  p_email      text,
  p_event      text,
  p_message_id text default null,
  p_campaign   text default null,
  p_slot       text default null,
  p_url        text default null,
  p_occurred   timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_uid   uuid;
begin
  if v_email is null or v_email = '' or p_event not in ('delivered','opened','clicked') then
    return;
  end if;

  select id into v_uid from auth.users where lower(email) = v_email limit 1;

  insert into public.email_engagement_events
    (email, user_id, event_type, provider_message_id, campaign, slot, url, occurred_at)
  values (v_email, v_uid, p_event, p_message_id, p_campaign, p_slot, p_url, coalesce(p_occurred, now()));

  -- Rollup only tracks real engagement; 'delivered' is kept as raw evidence but
  -- says nothing about a human, so it must never lift a tier.
  if v_uid is null or p_event = 'delivered' then
    return;
  end if;

  insert into public.email_engagement as ee
    (user_id, email, last_open_at, last_click_at, open_count, click_count,
     tier, tier_reason, tier_updated_at, updated_at)
  values (
    v_uid, v_email,
    case when p_event = 'opened'  then coalesce(p_occurred, now()) end,
    case when p_event = 'clicked' then coalesce(p_occurred, now()) end,
    case when p_event = 'opened'  then 1 else 0 end,
    case when p_event = 'clicked' then 1 else 0 end,
    'warm', 'engaged:' || p_event, now(), now()
  )
  on conflict (user_id) do update set
    email         = coalesce(excluded.email, ee.email),
    last_open_at  = greatest(ee.last_open_at,  excluded.last_open_at),
    last_click_at = greatest(ee.last_click_at, excluded.last_click_at),
    open_count    = ee.open_count  + excluded.open_count,
    click_count   = ee.click_count + excluded.click_count,
    tier            = 'warm',
    tier_reason     = 'engaged:' || p_event,
    tier_updated_at = now(),
    updated_at      = now();
end $$;

revoke all on function public.record_email_engagement(text,text,text,text,text,text,timestamptz) from public, anon, authenticated;

-- ── 4. Nightly tiering ─────────────────────────────────────────────────────
create or replace function public.recompute_email_tiers()
returns table (tier text, users int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_event timestamptz;
  v_bootstrap   boolean;
begin
  select min(occurred_at) into v_first_event
    from public.email_engagement_events
   where event_type in ('opened','clicked');

  -- Less than 14 days of real engagement data: hold the floor at 'cooling'.
  v_bootstrap := (v_first_event is null or v_first_event > now() - interval '14 days');

  with pool as (
    select p.id as user_id, lower(u.email) as email, u.last_sign_in_at, u.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.user_type in ('talent','actor')
       and (p.membership_status is null or p.membership_status <> 'active')
  ),
  scored as (
    select
      pool.user_id,
      pool.email,
      pool.last_sign_in_at,
      greatest(ee.last_open_at, ee.last_click_at) as last_engaged,
      pool.created_at
      from pool
      left join public.email_engagement ee on ee.user_id = pool.user_id
  ),
  decided as (
    select
      user_id, email, last_sign_in_at,
      case
        when created_at   > now() - interval '14 days' then 'warm'
        when last_engaged > now() - interval '30 days' then 'warm'
        when last_sign_in_at > now() - interval '7 days' then 'warm'
        when coalesce(last_engaged, last_sign_in_at) > now() - interval '60 days' then 'cooling'
        when coalesce(last_engaged, last_sign_in_at) > now() - interval '90 days' then 'cold'
        when last_engaged is null and last_sign_in_at is null then 'cooling'
        else 'paused'
      end as want,
      case
        when created_at   > now() - interval '14 days'   then 'new_account'
        when last_engaged > now() - interval '30 days'   then 'recent_open'
        when last_sign_in_at > now() - interval '7 days' then 'recent_login'
        when coalesce(last_engaged, last_sign_in_at) > now() - interval '60 days' then 'quiet_30_60d'
        when coalesce(last_engaged, last_sign_in_at) > now() - interval '90 days' then 'quiet_60_90d'
        when last_engaged is null and last_sign_in_at is null then 'no_signal_yet'
        else 'silent_90d'
      end as why
      from scored
  ),
  floored as (
    -- Bootstrap: never worse than 'cooling' while the open data is still young.
    select user_id, email, last_sign_in_at,
           case when v_bootstrap and want in ('cold','paused') then 'cooling' else want end as final_tier,
           case when v_bootstrap and want in ('cold','paused') then why || '+bootstrap_floor' else why end as final_why
      from decided
  )
  insert into public.email_engagement as ee
    (user_id, email, last_sign_in_at, tier, tier_reason, tier_updated_at, updated_at)
  select user_id, email, last_sign_in_at, final_tier, final_why, now(), now()
    from floored
  on conflict (user_id) do update set
    email           = coalesce(excluded.email, ee.email),
    last_sign_in_at = excluded.last_sign_in_at,
    tier            = excluded.tier,
    tier_reason     = excluded.tier_reason,
    tier_updated_at = now(),
    updated_at      = now();

  return query
    select ee.tier, count(*)::int as users
      from public.email_engagement ee
     group by ee.tier
     order by ee.tier;
end $$;

revoke all on function public.recompute_email_tiers() from public, anon, authenticated;

-- ── 5. Admin read-only summary ─────────────────────────────────────────────
-- Counts only; no addresses. Admin-gated inside the function so the admin page
-- can call it with the caller's own JWT.
create or replace function public.get_email_tier_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_out      jsonb;
begin
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and user_type in ('admin','super_admin')
  ) into v_is_admin;
  if not coalesce(v_is_admin, false) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'warm',        count(*) filter (where tier = 'warm'),
    'cooling',     count(*) filter (where tier = 'cooling'),
    'cold',        count(*) filter (where tier = 'cold'),
    'paused',      count(*) filter (where tier = 'paused'),
    'opens_7d',    (select count(*) from public.email_engagement_events
                     where event_type = 'opened'  and occurred_at > now() - interval '7 days'),
    'clicks_7d',   (select count(*) from public.email_engagement_events
                     where event_type = 'clicked' and occurred_at > now() - interval '7 days'),
    'first_event', (select min(occurred_at) from public.email_engagement_events
                     where event_type in ('opened','clicked')),
    'last_recompute', (select max(tier_updated_at) from public.email_engagement)
  ) into v_out
  from public.email_engagement;

  return v_out;
end $$;

grant execute on function public.get_email_tier_counts() to authenticated;

-- ── 6. Nightly cron ────────────────────────────────────────────────────────
-- 07:10 UTC / 3:10 AM ET -- after the evening send (22:00 UTC) has had its
-- opens come in, and before the morning send (13:00 UTC) reads the tiers.
select cron.unschedule('email-tier-recompute')
 where exists (select 1 from cron.job where jobname = 'email-tier-recompute');

select cron.schedule('email-tier-recompute', '10 7 * * *', $$ select public.recompute_email_tiers(); $$);

-- Tiering v2: the application signal (2026-09-16).
--
-- WHY. Asked what the 27 paying members did before they paid, the database gave
-- an unusually clean answer:
--
--   segment                        people   paid   conversion
--   no headshot, never applied        287      0        0.00%
--   headshot, never applied           240      0        0.00%
--   applied at least once             376     27        7.18%
--
-- Every single paying member submitted at least one application first. Not one
-- of the 527 who never applied has ever paid -- and many of them have been
-- receiving two emails a day for months. Timing says the same thing: median
-- signup-to-payment is 23.8 hours, 23 of 27 paid within 30 days of signing up,
-- only 4 after that.
--
-- Free accounts get exactly ONE submission for life, so "applied once" is really
-- "hit the paywall". That is the moment the pitch lands. Someone who has been
-- here a month and never applied has not reached that moment, and the evidence
-- says daily email does not move them there.
--
-- WHAT CHANGES. Two caps, applied AFTER the existing engagement tiers:
--
--   * Never applied + account 30+ days old  -> at best 'cold' (one email a week),
--     however recently they logged in.
--   * Same, plus no open, no click and no sign-in in 30 days -> 'paused'. This
--     one still respects the bootstrap floor: it needs real open data before it
--     will stop mailing anyone.
--
-- The first cap ignores the bootstrap floor deliberately. "Never applied in 30+
-- days" is not an engagement guess that open tracking might overturn -- it is a
-- recorded fact with a 0-for-527 record behind it. The SECOND cap does respect
-- it: the first cut of this function let one branch reach 'paused' during
-- bootstrap and silenced 5 people on login data alone, which is exactly the
-- guarantee the floor exists to keep. Nothing is silenced before there are 14
-- days of real opens.
--
-- WHAT DOES NOT CHANGE. Anyone who has applied keeps the normal tiers. Anyone
-- whose account is under 30 days old keeps the normal tiers -- new signups are
-- the funnel, and cutting their email would be cutting the thing that brings
-- them to their first application. Applying once lifts the cap immediately at
-- the next nightly run; opening an email still lifts someone to warm on the spot.

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

  v_bootstrap := (v_first_event is null or v_first_event > now() - interval '14 days');

  with pool as (
    select p.id as user_id, lower(u.email) as email, u.last_sign_in_at, u.created_at,
           exists (select 1 from public.applications a where a.talent_id = p.id) as has_applied
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.user_type in ('talent','actor')
       and (p.membership_status is null or p.membership_status <> 'active')
  ),
  scored as (
    select pool.*, greatest(ee.last_open_at, ee.last_click_at) as last_engaged
      from pool
      left join public.email_engagement ee on ee.user_id = pool.user_id
  ),
  decided as (
    select user_id, email, last_sign_in_at, last_engaged, created_at, has_applied,
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
  capped as (
    select user_id, email, last_sign_in_at,
      case
        -- Never applied, and here long enough to have had the chance.
        when not has_applied and created_at < now() - interval '30 days' then
          case
            when v_bootstrap then 'cold'          -- weekly ceiling, never silence, until open data exists
            when coalesce(last_engaged, '-infinity'::timestamptz)   < now() - interval '30 days'
             and coalesce(last_sign_in_at,'-infinity'::timestamptz) < now() - interval '30 days'
              then 'paused'
            when want = 'paused' then 'paused'   -- already paused on engagement grounds
            else 'cold'                          -- weekly ceiling regardless of login recency
          end
        when v_bootstrap and want in ('cold','paused') then 'cooling'
        else want
      end as final_tier,
      case
        when not has_applied and created_at < now() - interval '30 days'
          then 'never_applied_30d+/' || why || case when v_bootstrap then '+bootstrap_floor' else '' end
        when v_bootstrap and want in ('cold','paused') then why || '+bootstrap_floor'
        else why
      end as final_why
      from decided
  )
  insert into public.email_engagement as ee
    (user_id, email, last_sign_in_at, tier, tier_reason, tier_updated_at, updated_at)
  select user_id, email, last_sign_in_at, final_tier, final_why, now(), now()
    from capped
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

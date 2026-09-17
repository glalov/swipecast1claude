-- Tiering v4: fair open-tracking trial, then the full rule on its own (2026-09-17).
--
-- Owner-approved rule: a person stays on the premium upsell list if, in the last
-- 30 days, they opened or clicked the promo email OR showed website activity
-- (signed in, viewed a casting, applied, or created the account). Otherwise they
-- come off.
--
-- The catch v3 had: open tracking only began 2026-09-16, so on 2026-09-17 "no
-- opens in 30 days" really meant "no opens in ONE day". v3 cut 387 people partly
-- on that basis -- and a cut person receives no email, so they could never open
-- one and never prove interest.
--
-- v4 fixes that without a switch anyone has to flip:
--   * Until open tracking has 30 days of history (first recorded open + 30 days,
--     i.e. ~2026-10-16), inactive people are on 'cold': one email a week, on a
--     weekday spread by user id. About 4 chances each to open.
--   * From that date on, inactive people are 'paused' -- no upsell -- exactly
--     the approved rule. Computed from the data, so it switches over by itself
--     at the nightly run (cron 18, 07:10 UTC).
--
-- Active people are tiered as in v3:
--   warm     both sends: joined <14d, clicked or applied <30d, signed in or viewed
--            a casting <7d, or opened <30d having applied at some point
--   cooling  morning only: active in 30 days but lighter than the above
--   never applied + account 30+ days old -> morning only unless they click
--
-- Nobody is deleted. Opening an email lifts a person to 'warm' on the spot
-- (record_email_engagement); logging in, viewing a casting or applying brings a
-- paused person back at the next nightly run.

create or replace function public.recompute_email_tiers()
returns table (tier text, users int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_open  timestamptz;
  v_full_rule   boolean;
begin
  select min(occurred_at) into v_first_open
    from public.email_engagement_events
   where event_type in ('opened','clicked');

  -- Full rule once opens have been tracked for a whole 30-day window.
  v_full_rule := v_first_open is not null and now() >= v_first_open + interval '30 days';

  with pool as (
    select p.id as user_id, lower(u.email) as email, u.created_at, u.last_sign_in_at,
           (select max(v.viewed_at)  from public.recently_viewed_castings v where v.user_id = p.id)  as last_view,
           (select max(a.created_at) from public.applications a            where a.talent_id = p.id) as last_apply
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.user_type in ('talent','actor')
       and (p.membership_status is null or p.membership_status <> 'active')
  ),
  scored as (
    select pool.*, ee.last_open_at, ee.last_click_at,
           greatest(pool.created_at, pool.last_sign_in_at, pool.last_view, pool.last_apply,
                    ee.last_open_at, ee.last_click_at) as last_activity
      from pool
      left join public.email_engagement ee on ee.user_id = pool.user_id
  ),
  decided as (
    select user_id, email, last_sign_in_at,
      case
        when last_activity <= now() - interval '30 days' then
          case when v_full_rule then 'paused' else 'cold' end
        when last_apply is null and created_at < now() - interval '30 days' then
          case when last_click_at > now() - interval '30 days' then 'warm' else 'cooling' end
        when created_at      > now() - interval '14 days'
          or last_click_at   > now() - interval '30 days'
          or last_apply      > now() - interval '30 days'
          or last_sign_in_at > now() - interval '7 days'
          or last_view       > now() - interval '7 days'
          or (last_open_at   > now() - interval '30 days' and last_apply is not null)
          then 'warm'
        else 'cooling'
      end as final_tier,
      case
        when last_activity <= now() - interval '30 days' then
          case when v_full_rule then 'no_activity_30d' else 'no_activity_30d/open_trial_weekly' end
        when last_apply is null and created_at < now() - interval '30 days' then
          case when last_click_at > now() - interval '30 days' then 'never_applied/recent_click'
               else 'never_applied/active_30d' end
        when created_at      > now() - interval '14 days'  then 'new_account'
        when last_click_at   > now() - interval '30 days'  then 'recent_click'
        when last_apply      > now() - interval '30 days'  then 'recent_application'
        when last_sign_in_at > now() - interval '7 days'   then 'recent_login'
        when last_view       > now() - interval '7 days'   then 'recent_casting_view'
        when last_open_at    > now() - interval '30 days' and last_apply is not null then 'recent_open'
        else 'active_30d'
      end as final_why
      from scored
  )
  insert into public.email_engagement as ee
    (user_id, email, last_sign_in_at, tier, tier_reason, tier_updated_at, updated_at)
  select user_id, email, last_sign_in_at, final_tier, final_why, now(), now()
    from decided
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

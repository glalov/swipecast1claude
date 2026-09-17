-- Tiering v3: only people active in the last 30 days receive the upsell (2026-09-17).
--
-- Owner's decision: "I want only the ones who have some activity in recent weeks
-- to receive the promo email." v2 still mailed dormant accounts weekly (and anyone
-- who had ever applied daily, however long ago), and held a 14-day bootstrap floor
-- before silencing anyone. Both are gone.
--
-- ACTIVITY = any of these in the last 30 days:
--   * opened or clicked an email          (email_engagement)
--   * signed in                           (auth.users.last_sign_in_at)
--   * viewed a casting                    (recently_viewed_castings.viewed_at)
--   * applied to a casting                (applications.created_at)
--   * created the account
--
-- Casting views matter: last_sign_in_at only moves on a FRESH sign-in, so someone
-- who stays logged in and browses daily looks dormant by that column alone. On the
-- day this shipped, views kept 38 genuinely active people on the list who sign-in
-- data would have cut. Of 700 eligible: 313 active, 387 paused.
--
-- TIERS
--   paused   no activity in 30 days -> no upsell at all
--   warm     both sends: joined <14d, clicked or applied <30d, signed in or viewed
--            a casting <7d, or opened <30d having applied at some point
--   cooling  morning only: active in 30 days but lighter than the above
--
-- Never applied + account 30+ days old stays capped at morning-only unless they
-- click. Every one of the 27 paying members applied first; none of the 527 who
-- never applied has paid (see email_tiers_application_signal.sql).
--
-- Nobody is deleted and 'paused' is not permanent: signing in, viewing a casting
-- or applying brings someone back at the next nightly run (07:10 UTC).

create or replace function public.recompute_email_tiers()
returns table (tier text, users int)
language plpgsql
security definer
set search_path = public
as $$
begin
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
        when last_activity <= now() - interval '30 days' then 'paused'
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
        when last_activity <= now() - interval '30 days' then 'no_activity_30d'
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

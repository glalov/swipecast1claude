-- Agency Directory intro email (agd-intro edge function). Applied live 2026-10-02.
-- Eligibility: free, confirmed, talent/actor, 72h-14d old, has a headshot, not
-- suppressed / opted out, and not already logged under 'agency_directory_v1'.
create or replace function public.agd_intro_eligible(p_limit integer default 200)
returns table(id uuid, first_name text, email text)
language sql security definer set search_path to 'public' as $fn$
  select p.id, public.greeting_name(p.display_name) as first_name, lower(u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.user_type in ('talent','actor')
    and coalesce(p.account_status,'active') = 'active'
    and u.email_confirmed_at is not null
    and u.email is not null
    and p.created_at <= now() - interval '72 hours'
    and p.created_at >  now() - interval '14 days'
    -- Launch cutoff: only accounts created from here on (launch minus 72h) are ever
    -- mailed, so switching this on does not blast people who signed up before it existed.
    and p.created_at >= timestamptz '2026-09-29 20:30:00+00'
    and (p.membership_status is null or p.membership_status <> 'active')
    and coalesce(p.notification_email,true) = true
    and p.headshot_url is not null and p.headshot_url <> ''
    and lower(u.email) not in (select lower(e.email) from public.email_unsubscribes e where e.email is not null)
    and not exists (select 1 from public.email_preferences ep
                    where ep.user_id = p.id and (ep.announce_optout = true or ep.unsubscribed_at is not null))
    and not exists (select 1 from public.member_announce_logs l
                    where l.user_id = p.id and l.announce_key = 'agency_directory_v1')
  order by p.created_at asc
  limit p_limit;
$fn$;
revoke all on function public.agd_intro_eligible(integer) from public, anon, authenticated;

-- run_agd_intro() POSTs {action:"run"} to the edge function with the admin campaign
-- secret (copied from run_day2_getnoticed at apply time; never stored in this repo).
-- Cron: select cron.schedule('agd-intro-hourly','5 * * * *','select public.run_agd_intro()');
-- The function itself only sends in the 2 PM America/New_York hour.

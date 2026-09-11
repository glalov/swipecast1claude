-- 2026-09-10 — daily "you're getting noticed" recap (activity_digest)
--  * NON-PREMIUM ONLY: members with membership_status='active' are skipped here at run
--    time (so upgraders drop out automatically) AND in send-notification-email
--    (PREMIUM_EMAIL_BLOCKED includes activity_digest).
--  * "Reel plays" removed — free accounts can't upload reels. The email now shows the
--    member's real profile-completion % instead, computed in the edge function.
CREATE OR REPLACE FUNCTION public.run_activity_digest()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_fn_url text := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/send-notification-email';
begin
  for r in
    select n.user_id,
      count(*) filter (where n.type = 'application_profile_viewed') as profile_views,
      count(*) filter (where n.type = 'application_selected')       as shortlists
    from public.system_notifications n
    join public.profiles p on p.id = n.user_id
    where n.created_at >= now() - interval '24 hours'
      and n.type in ('application_profile_viewed','application_selected')
      and p.membership_status is distinct from 'active'
    group by n.user_id
  loop
    begin
      perform net.http_post(
        url     := v_fn_url,
        headers := ('{"Content-Type":"application/json"}'::jsonb || jsonb_build_object('Authorization', 'Bearer ' || public.notify_fn_secret())),
        body    := jsonb_build_object(
          'to_user_id',    r.user_id,
          'type',          'activity_digest',
          'profile_views', r.profile_views,
          'shortlists',    r.shortlists
        )
      );
    exception when others then
      null; -- one bad row must never abort the whole daily run
    end;
  end loop;
end;
$function$;

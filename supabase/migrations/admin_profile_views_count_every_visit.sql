-- Admin profile/tape views count EVERY visit, not once per application.
--
-- Before: system_notifications_application_activity_once_idx enforced one
-- 'application_profile_viewed' / 'application_video_viewed' row per
-- application FOREVER, and the RPC guarded the same way. An admin who opened
-- the same actor's profile three times in a day produced one view event, so
-- the daily "You're getting noticed" recap counted it as one casting director.
--
-- After: an admin/super-admin caller inserts a row on every visit (three opens
-- = three view events = "3 casting directors viewed your profile" in the
-- recap). Real casting directors keep the old once-per-application behaviour,
-- enforced in the function body. The unique index is narrowed to
-- 'application_selected' only, which must still fire once per application.

drop index if exists public.system_notifications_application_activity_once_idx;

create unique index if not exists system_notifications_application_selected_once_idx
  on public.system_notifications (related_application_id, type)
  where related_application_id is not null and type = 'application_selected';

create or replace function public.notify_admin_generated_application_activity(p_application uuid, p_activity text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cd_id uuid;
  v_talent uuid;
  v_title text;
  v_role text;
  v_cd_name text;
  v_type text;
  v_notif_title text;
  v_body text;
  v_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_activity not in ('profile_view','video_view') then
    raise exception 'invalid activity: %', p_activity;
  end if;

  select a.talent_id, c.cd_id, c.title, r.name,
         coalesce(
           nullif(btrim(c.casting_director_name),''),
           nullif(btrim(c.posted_by_label),''),
           nullif(btrim(c.prod),''),
           nullif(btrim(cd.company_name),''),
           nullif(btrim(cd.display_name),''),
           'The casting director'
         )
    into v_talent, v_cd_id, v_title, v_role, v_cd_name
    from public.applications a
    join public.castings c on c.id = a.casting_id
    left join public.roles r on r.id = a.role_id
    left join public.profiles cd on cd.id = c.cd_id
   where a.id = p_application;

  if v_talent is null then
    raise exception 'application not found';
  end if;

  v_is_admin := public.is_admin();

  -- Only the casting's owner (or an admin) can trigger this.
  if v_cd_id is distinct from v_uid and not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_type := case when p_activity = 'profile_view' then 'application_profile_viewed' else 'application_video_viewed' end;
  v_notif_title := case when p_activity = 'profile_view' then 'Your profile was viewed' else 'Your audition was watched' end;

  if p_activity = 'profile_view' then
    v_body := v_cd_name || ' viewed your profile'
      || case when v_role is not null then ' for ' || v_role else '' end
      || case when v_title is not null then ' on "' || v_title || '"' else '' end
      || ' — your headshots, résumé, and reel were all in front of the casting team. It''s not a booking or a rejection, just a sign your application is getting real attention.';
  else
    v_body := v_cd_name || ' watched your audition video'
      || case when v_role is not null then ' for ' || v_role else '' end
      || case when v_title is not null then ' on "' || v_title || '"' else '' end
      || '. Your work is being seen by the casting team. It''s not a booking or a rejection.';
  end if;

  begin
    if v_is_admin then
      -- Every admin visit is its own view event.
      insert into public.system_notifications
        (user_id, type, title, body, link_url, related_application_id)
      values
        (v_talent, v_type, v_notif_title, v_body, '/talent-dashboard', p_application);
    else
      -- Real casting directors: still once per application per activity.
      insert into public.system_notifications
        (user_id, type, title, body, link_url, related_application_id)
      select v_talent, v_type, v_notif_title, v_body, '/talent-dashboard', p_application
      where not exists (
        select 1 from public.system_notifications
         where related_application_id = p_application and type = v_type
      );
    end if;
  exception when unique_violation then
    null;
  end;
end;
$function$;

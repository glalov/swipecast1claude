-- decide_application: email on EVERY genuine transition into "selected".
--
-- Before: the shortlist email fired only the FIRST time an application ever
-- became "selected" (guarded by the existence of an application_selected
-- notification row). Re-selecting an actor you'd previously moved to Hold/Pass
-- sent nothing, so it never appeared in Resend — the source of "I shortlisted
-- more people than I see emails for."
--
-- After: the email fires on every real pending/hold/rejected -> selected
-- transition (the `v_prev = p_status` no-op guard still prevents a resend when
-- the status did not actually change, so repeated selects of an already-selected
-- actor stay silent). Result: 1:1 correspondence between a Select action and a
-- Resend "application_selected" send. The in-app notification is still created
-- once per application to avoid duplicate notification rows.
--
-- Also hardens the "who shortlisted you" name: admin-generated postings never
-- fall back to the CD *profile* (platform) name, and any castslate/swipecast
-- brand string is replaced with "A casting director".

CREATE OR REPLACE FUNCTION public.decide_application(p_application uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_cd_id    uuid;
  v_talent   uuid;
  v_prev     text;
  v_casting  uuid;
  v_title    text;
  v_role     text;
  v_cd_name  text;
  v_admin    boolean;
  v_notif_id uuid;
  v_already  boolean;
  v_fn_url   text := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/send-notification-email';
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_status not in ('pending','hold','selected','rejected') then
    raise exception 'invalid status: %', p_status;
  end if;

  select a.status, a.talent_id, a.casting_id, c.cd_id, c.title, r.name, c.is_admin_created,
         coalesce(
           nullif(btrim(c.casting_director_name),''),
           nullif(btrim(c.posted_by_label),''),
           nullif(btrim(c.prod),''),
           case when c.is_admin_created is not true then nullif(btrim(cd.company_name),'') end,
           case when c.is_admin_created is not true then nullif(btrim(cd.display_name),'') end,
           'A casting director'
         )
    into v_prev, v_talent, v_casting, v_cd_id, v_title, v_role, v_admin, v_cd_name
    from public.applications a
    join public.castings c on c.id = a.casting_id
    left join public.roles r on r.id = a.role_id
    left join public.profiles cd on cd.id = c.cd_id
   where a.id = p_application;

  if v_prev is null then
    raise exception 'application not found';
  end if;

  if v_cd_id is distinct from v_uid and not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_cd_name ~* '(castslate|swipecast)' then
    v_cd_name := 'A casting director';
  end if;

  if v_prev = p_status then
    return;
  end if;

  update public.applications
     set status = p_status,
         reviewed_at = case when p_status = 'pending' then null else now() end
   where id = p_application;

  if p_status = 'selected' then
    select exists(
      select 1 from public.system_notifications
       where related_application_id = p_application and type = 'application_selected'
    ) into v_already;

    if not v_already then
      begin
        insert into public.system_notifications
          (user_id, type, title, body, link_url, related_application_id)
        values (
          v_talent,
          'application_selected',
          'You have been shortlisted',
          v_cd_name || ' shortlisted you'
            || case when v_role  is not null then ' for ' || v_role  else '' end
            || case when v_title is not null then ' on "' || v_title || '"' else '' end
            || '. Open your applications to see what that means and track the update.',
          '/talent-dashboard',
          p_application
        )
        returning id into v_notif_id;
      exception when others then
        v_notif_id := null;
      end;
    end if;

    begin
      perform net.http_post(
        url     := v_fn_url,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body    := jsonb_build_object(
          'to_user_id',   v_talent,
          'type',         'application_selected',
          'casting_id',   v_casting,
          'project_name', v_title,
          'role_name',    v_role,
          'cd_name',      v_cd_name
        )
      );
      if v_notif_id is not null then
        update public.system_notifications set emailed_at = now() where id = v_notif_id;
      end if;
    exception when others then
      null;
    end;
  end if;
end;
$function$;

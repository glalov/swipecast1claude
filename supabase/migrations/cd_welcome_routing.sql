-- Welcome-email routing (2026-09-26)
--
-- Bug: casting directors who signed up with Google got the ACTOR welcome.
-- An OAuth signup is created and confirmed in the same INSERT, while the
-- profile still has the default user_type 'talent'; the app only switches it
-- to 'cd' a few seconds later (swipecast_pending_type). The welcome trigger
-- fired in between.
--
-- Fix:
--   * Email/password signups: the role is already in the profile (signup
--     metadata) when the address is confirmed, so send straight away —
--     talent/actor -> new_actor_welcome, cd/producer/studio/creator -> cd_welcome.
--   * OAuth signups: don't send yet. Stamp profiles.welcome_due_at = now()+3min
--     and let process_due_welcomes() (pg_cron, every minute) send whichever
--     welcome matches the role the account has by then.
--   * send-notification-email also routes by the CURRENT user_type, so an
--     industry account can never receive the actor template.
-- Guard stays profiles.welcome_email_sent_at: one welcome per account, ever.

alter table public.profiles add column if not exists welcome_due_at timestamptz;

create or replace function public.welcome_type_for(p_user_type text)
 returns text
 language sql
 immutable
as $$
  select case
    when p_user_type in ('talent','actor') then 'new_actor_welcome'
    when p_user_type in ('cd','producer','studio','creator') then 'cd_welcome'
    else null
  end;
$$;

create or replace function public.send_new_actor_welcome_email()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user_type text;
  v_sent      timestamptz;
  v_type      text;
  v_provider  text;
  v_fn_url    text := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/send-notification-email';
begin
  -- Only act once the email is confirmed.
  if new.email_confirmed_at is null then
    return new;
  end if;
  -- On UPDATE, only when confirmation is newly granted.
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;

  select user_type, welcome_email_sent_at
    into v_user_type, v_sent
    from public.profiles
   where id = new.id;

  if v_sent is not null then
    return new;
  end if;

  -- OAuth (Google etc.): the account's role is chosen AFTER this moment, so
  -- defer; process_due_welcomes() sends the right one a few minutes later.
  v_provider := coalesce(new.raw_app_meta_data->>'provider', 'email');
  if v_provider <> 'email' then
    update public.profiles
       set welcome_due_at = now() + interval '3 minutes'
     where id = new.id and welcome_email_sent_at is null;
    return new;
  end if;

  v_type := public.welcome_type_for(v_user_type);
  if v_type is null then
    return new;
  end if;

  begin
    perform net.http_post(
      url     := v_fn_url,
      headers := ('{"Content-Type":"application/json"}'::jsonb || jsonb_build_object('Authorization', 'Bearer ' || public.notify_fn_secret())),
      body    := jsonb_build_object('to_user_id', new.id, 'type', v_type)
    );
    update public.profiles set welcome_email_sent_at = now(), welcome_due_at = null where id = new.id;
  exception when others then
    -- Never let an email hiccup break signup/confirmation.
    null;
  end;

  return new;
end;
$function$;

create or replace function public.process_due_welcomes()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r      record;
  v_type text;
  n      int := 0;
  v_fn_url text := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/send-notification-email';
begin
  for r in
    select id, user_type
      from public.profiles
     where welcome_due_at is not null
       and welcome_due_at <= now()
       and welcome_email_sent_at is null
     order by welcome_due_at
     limit 50
     for update skip locked
  loop
    v_type := public.welcome_type_for(r.user_type);
    if v_type is null then
      update public.profiles set welcome_due_at = null where id = r.id;   -- admins etc.: no welcome
      continue;
    end if;
    begin
      perform net.http_post(
        url     := v_fn_url,
        headers := ('{"Content-Type":"application/json"}'::jsonb || jsonb_build_object('Authorization', 'Bearer ' || public.notify_fn_secret())),
        body    := jsonb_build_object('to_user_id', r.id, 'type', v_type)
      );
      update public.profiles set welcome_email_sent_at = now(), welcome_due_at = null where id = r.id;
      n := n + 1;
    exception when others then
      null;   -- left due; retried next minute
    end;
  end loop;
  return n;
end;
$function$;

revoke all on function public.process_due_welcomes() from public, anon, authenticated;
revoke all on function public.welcome_type_for(text) from public, anon, authenticated;

select cron.schedule('welcome-due-every-minute', '* * * * *', 'select public.process_due_welcomes();');

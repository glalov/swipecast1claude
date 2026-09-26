-- "Your casting is live" email to casting directors (2026-09-26).
--
-- Fires once per casting, when a casting posted by an industry account
-- (cd/producer/studio/creator, never admin-created/generated) becomes VISIBLE on
-- Browse Castings: status 'open' + published + go-live reached + not expired —
-- the same test the Browse page uses. Normally that is the instant an admin
-- approves it (pending_review -> open). If the CD scheduled a future go-live,
-- the email waits (live_email_due_at) and process_casting_live_emails(), run
-- every minute by pg_cron, sends it when the casting actually appears.
-- Guard: castings.live_email_sent_at (one email per casting, ever).

alter table public.castings
  add column if not exists live_email_sent_at timestamptz,
  add column if not exists live_email_due_at  timestamptz;

-- Castings that were already live before this existed never get a late email.
-- Triggers paused for this one statement so their updated_at is not bumped
-- (only the new, empty column is written; no existing value changes).
set local session_replication_role = replica;
update public.castings c
   set live_email_sent_at = coalesce(c.created_at, now())
  where c.live_email_sent_at is null
    and c.status = 'open' and c.published = true;
set local session_replication_role = origin;

create or replace function public.casting_is_browse_visible(c public.castings)
 returns boolean
 language sql
 stable
as $$
  select c.status = 'open'
     and coalesce(c.published, false)
     and (c.go_live_at is null or c.go_live_at <= now())
     and (c.expires_at is null or c.expires_at > now())
     and (c.deadline is null or c.deadline >= (now() at time zone 'America/New_York')::date);
$$;

create or replace function public.send_casting_live_email(p_casting uuid, p_cd uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/send-notification-email',
    headers := ('{"Content-Type":"application/json"}'::jsonb || jsonb_build_object('Authorization', 'Bearer ' || public.notify_fn_secret())),
    body    := jsonb_build_object('to_user_id', p_cd, 'type', 'casting_live', 'casting_id', p_casting)
  );
  update public.castings set live_email_sent_at = now(), live_email_due_at = null where id = p_casting;
end;
$function$;

create or replace function public.castings_live_email_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_type text;
begin
  -- Only the transition INTO open+published matters (approval / re-approval).
  if not (new.status = 'open' and coalesce(new.published, false)) then
    return new;
  end if;
  if old.status = 'open' and coalesce(old.published, false) then
    return new;
  end if;
  if new.live_email_sent_at is not null or coalesce(new.is_admin_created, false) then
    return new;
  end if;
  select user_type into v_type from public.profiles where id = new.cd_id;
  if v_type is null or v_type not in ('cd','producer','studio','creator') then
    return new;
  end if;
  begin
    if public.casting_is_browse_visible(new) then
      perform public.send_casting_live_email(new.id, new.cd_id);
    elsif new.go_live_at is not null and new.go_live_at > now() then
      update public.castings set live_email_due_at = new.go_live_at where id = new.id;
    end if;
  exception when others then
    null;   -- an email hiccup must never block an approval
  end;
  return new;
end;
$function$;

drop trigger if exists castings_live_email on public.castings;
create trigger castings_live_email
  after update of status, published on public.castings
  for each row execute function public.castings_live_email_trg();

create or replace function public.process_casting_live_emails()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.castings%rowtype;   -- a plain record cannot be cast to castings
  n int := 0;
begin
  for r in
    select c.*
      from public.castings c
     where c.live_email_due_at is not null
       and c.live_email_due_at <= now()
       and c.live_email_sent_at is null
     order by c.live_email_due_at
     limit 50
     for update skip locked
  loop
    if public.casting_is_browse_visible(r) then
      begin
        perform public.send_casting_live_email(r.id, r.cd_id);
        n := n + 1;
      exception when others then null;
      end;
    elsif r.status <> 'open' or not coalesce(r.published, false) then
      update public.castings set live_email_due_at = null where id = r.id;   -- pulled before go-live
    end if;
  end loop;
  return n;
end;
$function$;

revoke all on function public.send_casting_live_email(uuid, uuid) from public, anon, authenticated;
revoke all on function public.process_casting_live_emails() from public, anon, authenticated;
revoke all on function public.castings_live_email_trg() from public, anon, authenticated;

select cron.schedule('casting-live-every-minute', '* * * * *', 'select public.process_casting_live_emails();');

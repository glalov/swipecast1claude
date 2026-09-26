-- 1) "You're approved to post" email (2026-09-26)
--    Sent once to a casting director the moment an admin turns on
--    profiles.can_post_castings (Admin -> "Allow posting" -> admin_set_posting).
--    Guard: profiles.posting_approved_email_sent_at. Only an admin (or a
--    service/SQL session with no auth.uid()) flipping the flag counts, so a user
--    writing their own row can never make it send.
-- 2) Company name required to post
--    "Continue with Google" CD signups never saw the company field. The site now
--    asks (CompanyStep); these triggers make it impossible to skip:
--    castings_require_company refuses a CD casting without one, and
--    profiles_keep_company stops a CD clearing it later. Admins are exempt.

alter table public.profiles
  add column if not exists posting_approved_email_sent_at timestamptz;

-- CDs already approved never get a late email. Triggers paused so updated_at is
-- untouched (only the new, empty column is written).
set local session_replication_role = replica;
update public.profiles
   set posting_approved_email_sent_at = coalesce(verification_approved_at, now())
 where can_post_castings is true and posting_approved_email_sent_at is null;
set local session_replication_role = origin;

create or replace function public.profiles_posting_approved_email_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.can_post_castings is not true or old.can_post_castings is true then return new; end if;
  if new.posting_approved_email_sent_at is not null then return new; end if;
  if coalesce(new.user_type, '') not in ('cd','producer','studio','creator') then return new; end if;
  if auth.uid() is not null and not public.is_admin() then return new; end if;
  begin
    perform net.http_post(
      url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/send-notification-email',
      headers := ('{"Content-Type":"application/json"}'::jsonb || jsonb_build_object('Authorization', 'Bearer ' || public.notify_fn_secret())),
      body    := jsonb_build_object('to_user_id', new.id, 'type', 'posting_approved')
    );
    new.posting_approved_email_sent_at := now();
  exception when others then
    null;   -- an email hiccup must never block the approval
  end;
  return new;
end;
$function$;

drop trigger if exists profiles_posting_approved_email on public.profiles;
create trigger profiles_posting_approved_email
  before update of can_post_castings on public.profiles
  for each row execute function public.profiles_posting_approved_email_trg();

create or replace function public.castings_require_company()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_type text; v_company text;
begin
  if coalesce(new.is_admin_created, false) or public.is_admin() then return new; end if;
  -- Drafts can still be saved; only posting (insert or submit for review) is checked.
  if coalesce(new.status, '') not in ('pending_review','open') then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select user_type, company_name into v_type, v_company from public.profiles where id = new.cd_id;
  if v_type in ('cd','producer','studio','creator') and coalesce(trim(v_company), '') = '' then
    raise exception 'Please add your company or production to your profile before posting a casting.'
      using errcode = 'P0001', hint = 'company_name_required';
  end if;
  return new;
end;
$function$;

drop trigger if exists castings_require_company on public.castings;
create trigger castings_require_company
  before insert or update of status on public.castings
  for each row execute function public.castings_require_company();

create or replace function public.profiles_keep_company()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(new.user_type, '') in ('cd','producer','studio','creator')
     and coalesce(trim(old.company_name), '') <> ''
     and coalesce(trim(new.company_name), '') = ''
     and not public.is_admin() then
    raise exception 'Please enter your company or production.' using errcode = 'P0001', hint = 'company_name_required';
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_keep_company on public.profiles;
create trigger profiles_keep_company
  before update of company_name on public.profiles
  for each row execute function public.profiles_keep_company();

revoke all on function public.profiles_posting_approved_email_trg() from public, anon, authenticated;
revoke all on function public.castings_require_company() from public, anon, authenticated;
revoke all on function public.profiles_keep_company() from public, anon, authenticated;

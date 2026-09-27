-- Lock admin-controlled fields (2026-09-26).
--
-- The row-level policies only asked "is this your own row?", never "which
-- columns are you changing?". A signed-in user could therefore write, straight
-- from the browser console, their own membership_status (free Premium),
-- user_type (admin), can_post_castings, verified/featured, or clear a ban; a CD
-- could set their own casting to open/published/featured (skipping review); an
-- actor could insert an application already 'selected'; a message recipient
-- could rewrite the message. And handle_new_user copied user_type straight from
-- signup metadata, which the browser controls, so a new account could be born
-- an admin.
--
-- Rule: a write is PRIVILEGED when it does not come directly from a browser
-- session (current_user is not authenticated/anon: service role, cron, and
-- SECURITY DEFINER functions such as the admin_* RPCs, stripe-webhook,
-- verification-webhook, submit_application) or when the caller is an admin.
-- Unprivileged writes may not touch the fields below. The guard functions are
-- SECURITY INVOKER on purpose: current_user must be the caller's role.

create or replace function public.cs_write_is_privileged()
 returns boolean
 language sql
 stable
as $$
  select current_user not in ('authenticated', 'anon') or coalesce(public.is_admin(), false);
$$;

-- ── Signup: account type from metadata may only be talent or cd ─────────────
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  age_text text := meta->>'age';
  age_int int := CASE WHEN age_text ~ '^[0-9]+$' THEN age_text::int ELSE NULL END;
  v_type text := CASE WHEN meta->>'user_type' IN ('talent','cd') THEN meta->>'user_type' ELSE 'talent' END;
BEGIN
  INSERT INTO public.profiles (
    id, email, user_type, display_name,
    location, gender, age, height, weight, hair, eyes, ethnicity,
    union_status, bio, training, skills, agent, talent_types,
    body_type, age_range,
    company_name, company_role, website,
    instagram, phone, credits,
    onboarded,
    is_minor, guardian_email, guardian_name
  ) VALUES (
    new.id,
    new.email,
    v_type,
    COALESCE(
      NULLIF(btrim(meta->>'display_name'),''),
      NULLIF(btrim(meta->>'full_name'),''),
      NULLIF(btrim(meta->>'name'),'')
    ),
    NULLIF(meta->>'location',''),
    NULLIF(meta->>'gender',''),
    age_int,
    NULLIF(meta->>'height',''),
    NULLIF(meta->>'weight',''),
    NULLIF(meta->>'hair',''),
    NULLIF(meta->>'eyes',''),
    NULLIF(meta->>'ethnicity',''),
    NULLIF(meta->>'union_status',''),
    NULLIF(meta->>'bio',''),
    NULLIF(meta->>'training',''),
    CASE WHEN jsonb_typeof(meta->'skills')='array'
         THEN ARRAY(SELECT jsonb_array_elements_text(meta->'skills'))
         ELSE '{}'::text[] END,
    NULLIF(meta->>'agent',''),
    CASE WHEN jsonb_typeof(meta->'talent_types')='array'
         THEN ARRAY(SELECT jsonb_array_elements_text(meta->'talent_types'))
         ELSE '{}'::text[] END,
    NULLIF(meta->>'body_type',''),
    NULLIF(meta->>'age_range',''),
    NULLIF(meta->>'company_name',''),
    NULLIF(meta->>'company_role',''),
    NULLIF(meta->>'website',''),
    NULLIF(meta->>'instagram',''),
    NULLIF(meta->>'phone',''),
    NULLIF(meta->>'credits',''),
    COALESCE((meta->>'onboarded')::boolean, false),
    COALESCE(age_int < 18, false),
    NULLIF(meta->>'guardian_email',''),
    NULLIF(meta->>'guardian_name','')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$function$;

-- ── Profiles ────────────────────────────────────────────────────────────────
create or replace function public.profiles_guard_admin_fields()
 returns trigger
 language plpgsql
as $function$
declare
  protected text[] := array[
    'id','email','created_at','is_minor',
    'membership_status','plan_type','membership_start_date','membership_end_date','payment_status',
    'stripe_customer_id','stripe_subscription_id','subscription_status','premium_started_at',
    'current_period_end','cancel_at_period_end','plan_price','past_due_since','premium_locked_at',
    'verification_provider','verification_session_id','verification_status','identity_verified',
    'background_check_status','can_post_castings','verification_submitted_at','verification_approved_at',
    'verification_rejected_at','verification_notes',
    'verified','featured','suspended','suspended_reason','suspended_at','banned','banned_reason','banned_at',
    'deleted_at',
    'premium_welcome_sent_at','welcome_email_sent_at','welcome_due_at','day2_email_sent_at',
    'posting_approved_email_sent_at'];
  changed text[];
begin
  if public.cs_write_is_privileged() then return new; end if;

  if tg_op = 'INSERT' then
    -- The app's fallback insert only sends id/email/user_type/display_name.
    if new.user_type not in ('talent','cd') then new.user_type := 'talent'; end if;
    if coalesce(new.membership_status, 'free') <> 'free'
       or new.can_post_castings is true or new.identity_verified is true
       or new.verified is true or new.featured is true
       or coalesce(new.verification_status, 'not_started') <> 'not_started'
       or new.stripe_customer_id is not null or new.stripe_subscription_id is not null
       or new.subscription_status is not null or new.premium_started_at is not null
       or new.current_period_end is not null then
      raise exception 'Not allowed to set account status fields.' using errcode = '42501';
    end if;
    return new;
  end if;

  select array_agg(n.key) into changed
    from jsonb_each(to_jsonb(new)) n
   where n.key = any(protected)
     and n.value is distinct from (to_jsonb(old) -> n.key);
  if changed is not null then
    raise exception 'Not allowed to change: %', array_to_string(changed, ', ') using errcode = '42501';
  end if;

  -- Account type: only the actor <-> casting-director switch (Google CD signup).
  if new.user_type is distinct from old.user_type
     and not (old.user_type in ('talent','cd') and new.user_type in ('talent','cd')) then
    raise exception 'Not allowed to change account type.' using errcode = '42501';
  end if;

  -- Deactivate / reactivate / request deletion are the user's own choices.
  if new.account_status is distinct from old.account_status
     and not (coalesce(old.account_status,'active') in ('active','deactivated','deletion_requested')
              and new.account_status in ('active','deactivated','deletion_requested')) then
    raise exception 'Not allowed to change account status.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_guard_admin_fields on public.profiles;
create trigger profiles_guard_admin_fields
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_admin_fields();

-- ── Castings ────────────────────────────────────────────────────────────────
-- approved_at: set the first time a privileged write opens a casting. A CD can
-- reopen their own casting only if it was approved before.
alter table public.castings add column if not exists approved_at timestamptz;

set local session_replication_role = replica;
update public.castings
   set approved_at = coalesce(live_email_sent_at, created_at, now())
 where approved_at is null and status in ('open','closed','archived');
set local session_replication_role = origin;

create or replace function public.castings_guard_admin_fields()
 returns trigger
 language plpgsql
as $function$
begin
  if public.cs_write_is_privileged() then
    if new.status = 'open' and new.approved_at is null then new.approved_at := now(); end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, '') not in ('draft','pending_review') then new.status := 'pending_review'; end if;
    new.published := false;
    new.featured := false;
    new.admin_verified := null;
    new.is_admin_created := false;
    new.approved_at := null;
    new.live_email_sent_at := null;
    new.live_email_due_at := null;
    return new;
  end if;

  -- Fields only the team sets: silently kept as they were.
  new.cd_id := old.cd_id;
  new.featured := old.featured;
  new.admin_verified := old.admin_verified;
  new.is_admin_created := old.is_admin_created;
  new.approved_at := old.approved_at;
  new.live_email_sent_at := old.live_email_sent_at;
  new.live_email_due_at := old.live_email_due_at;
  -- The "posted" date may only move forward to a future go-live (edit modal).
  if new.created_at is distinct from old.created_at and not (new.created_at > now()) then
    new.created_at := old.created_at;
  end if;
  -- Never-approved castings cannot go live from the browser.
  if old.approved_at is null then
    if new.status = 'open' or new.status = 'closed' or new.status = 'archived' then
      new.status := case when old.status in ('draft','pending_review') then old.status else 'pending_review' end;
    end if;
    new.published := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists castings_guard_admin_fields on public.castings;
create trigger castings_guard_admin_fields
  before insert or update on public.castings
  for each row execute function public.castings_guard_admin_fields();

-- ── Applications: a direct insert is always a plain pending self-submission ─
create or replace function public.applications_guard_admin_fields()
 returns trigger
 language plpgsql
as $function$
begin
  if public.cs_write_is_privileged() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.source := 'self';
    new.reviewed_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists applications_guard_admin_fields on public.applications;
create trigger applications_guard_admin_fields
  before insert on public.applications
  for each row execute function public.applications_guard_admin_fields();

-- ── Messages: a recipient may only mark a message read ──────────────────────
create or replace function public.messages_guard_admin_fields()
 returns trigger
 language plpgsql
as $function$
declare v_read timestamptz := new.read_at;
begin
  if public.cs_write_is_privileged() then return new; end if;
  new := old;
  new.read_at := v_read;
  return new;
end;
$function$;

drop trigger if exists messages_guard_admin_fields on public.messages;
create trigger messages_guard_admin_fields
  before update on public.messages
  for each row execute function public.messages_guard_admin_fields();

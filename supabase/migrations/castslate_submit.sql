-- CastSlate Submit (2026-09-26)
-- Admin picks a casting posted by a real, approved CD; the castslate-submit-match
-- edge function proposes every matching actor per role; admin reviews and submits.
--
-- Rules this migration enforces:
--   * A CastSlate submission never uses an actor's free submission. Both cap
--     checks (submit_application + enforce_weekly_submission_cap) count
--     self-submissions only.
--   * Only admins can create a CastSlate submission. A talent inserting their own
--     row with source='castslate' to dodge the cap is rejected by the trigger.
--   * Actors can opt out (profiles.castslate_submit_opt_in, default ON). The RPC
--     re-checks it at submit time, so an opt-out between "find" and "submit" wins.
--   * CDs are told nothing: the row is an ordinary application to them.

alter table public.applications
  add column if not exists source text not null default 'self',
  add column if not exists submitted_by uuid;
do $$ begin
  alter table public.applications
    add constraint applications_source_chk check (source in ('self','castslate'));
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists castslate_submit_opt_in boolean not null default true;

create table if not exists public.castslate_submit_runs (
  id          uuid primary key default gen_random_uuid(),
  casting_id  uuid not null references public.castings(id) on delete cascade,
  admin_id    uuid not null,
  submitted   int  not null default 0,
  skipped     int  not null default 0,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
alter table public.castslate_submit_runs enable row level security;
drop policy if exists castslate_submit_runs_admin_read on public.castslate_submit_runs;
create policy castslate_submit_runs_admin_read on public.castslate_submit_runs
  for select using (public.is_admin());

-- Free cap: self-submissions only.
create or replace function public.enforce_weekly_submission_cap()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_membership text;
  v_count int;
begin
  -- Backend/service_role jobs (no JWT) bypass entirely.
  if auth.uid() is null then
    return new;
  end if;

  -- Admins / seeding bypass entirely.
  if public.is_admin() then
    return new;
  end if;

  -- Only an admin may file a CastSlate submission. Without this a free actor
  -- could insert their own row tagged 'castslate' and skip the cap.
  if new.source = 'castslate' then
    raise exception 'castslate submissions are admin-only' using errcode = '42501';
  end if;

  select coalesce(membership_status, 'free')
    into v_membership
    from public.profiles
   where id = new.talent_id;

  -- Premium = unlimited.
  if v_membership = 'active' then
    return new;
  end if;

  -- Free actors: ONE self-submission per account, for life. CastSlate
  -- submissions made on their behalf do not count.
  select count(*) into v_count
    from public.applications
   where talent_id = new.talent_id
     and source <> 'castslate';

  if v_count >= 1 then
    raise exception 'free submission limit reached' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

create or replace function public.submit_application(p_casting uuid, p_role uuid, p_cover text DEFAULT NULL::text, p_photo text DEFAULT NULL::text, p_video_url text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_membership text;
  v_total_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(membership_status, 'free')
    into v_membership
    from public.profiles
   where id = auth.uid();

  -- Premium = unlimited. Free = one self-submission ever, then the paywall.
  -- CastSlate submissions made on the actor's behalf never count.
  if v_membership <> 'active' then
    select count(*) into v_total_count
      from public.applications
     where talent_id = auth.uid()
       and source <> 'castslate';

    if v_total_count >= 1 then
      -- Message must keep the words "submission limit": the client matches on it.
      raise exception 'free submission limit reached' using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1 from public.applications
     where talent_id = auth.uid() and role_id = p_role
  ) then
    raise exception 'already submitted to this role' using errcode = '23505';
  end if;

  insert into public.applications (casting_id, role_id, talent_id, cover_note, selected_photo_url, video_note_url)
  values (p_casting, p_role, auth.uid(), p_cover, p_photo, p_video_url);
end;
$function$;

-- Admin submit. p_items = [{"role_id": uuid, "talent_id": uuid}, ...]
-- Every row is re-validated here; the client list is only a proposal.
create or replace function public.admin_castslate_submit(p_casting uuid, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ok boolean;
  v_item jsonb;
  v_role uuid;
  v_talent uuid;
  v_photo text;
  v_inserted int := 0;
  v_skipped int := 0;
  v_reasons jsonb := '{}'::jsonb;
  v_reason text;
  v_rows int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  -- Real, approved CD's live casting only. Admin-posted / generated castings,
  -- and castings with nudity (actors must choose those themselves), are refused.
  select exists (
    select 1
      from public.castings c
      join public.profiles cd on cd.id = c.cd_id
     where c.id = p_casting
       and coalesce(c.is_admin_created, false) = false
       and c.status = 'open'
       and c.published = true
       and coalesce(c.has_nudity, false) = false
       and (c.deadline is null or c.deadline >= current_date)
       and cd.user_type = 'cd'
       and cd.can_post_castings = true
  ) into v_ok;
  if not v_ok then
    raise exception 'casting is not eligible for CastSlate Submit' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_reason := null;
    v_role := nullif(v_item->>'role_id', '')::uuid;
    v_talent := nullif(v_item->>'talent_id', '')::uuid;

    if v_role is null or v_talent is null
       or not exists (select 1 from public.roles r where r.id = v_role and r.casting_id = p_casting) then
      v_reason := 'bad_role';
    else
      select p.headshot_url into v_photo
        from public.profiles p
       where p.id = v_talent
         and p.user_type = 'talent'
         and p.castslate_submit_opt_in = true
         and coalesce(p.banned, false) = false
         and coalesce(p.suspended, false) = false
         and coalesce(p.is_minor, false) = false
         and p.deleted_at is null
         and p.deactivated_at is null
         and p.deletion_requested_at is null
         and coalesce(p.headshot_url, '') <> '';
      if not found then
        v_reason := 'not_eligible';
      end if;
    end if;

    if v_reason is null then
      insert into public.applications (casting_id, role_id, talent_id, selected_photo_url, source, submitted_by)
      values (p_casting, v_role, v_talent, v_photo, 'castslate', auth.uid())
      on conflict (role_id, talent_id) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 then
        v_inserted := v_inserted + 1;
      else
        v_reason := 'already_applied';
      end if;
    end if;

    if v_reason is not null then
      v_skipped := v_skipped + 1;
      v_reasons := jsonb_set(v_reasons, array[v_reason], to_jsonb(coalesce((v_reasons->>v_reason)::int, 0) + 1));
    end if;
  end loop;

  insert into public.castslate_submit_runs (casting_id, admin_id, submitted, skipped, detail)
  values (p_casting, auth.uid(), v_inserted, v_skipped, jsonb_build_object('skipped_reasons', v_reasons));

  return jsonb_build_object('submitted', v_inserted, 'skipped', v_skipped, 'skipped_reasons', v_reasons);
end;
$function$;

revoke all on function public.admin_castslate_submit(uuid, jsonb) from public, anon;
grant execute on function public.admin_castslate_submit(uuid, jsonb) to authenticated;

-- submit_audition's legacy 3-per-day free limit also counts self-submissions only
-- (applied live as migration castslate_submit_audition_count; body identical to the
-- previous version apart from the "source <> 'castslate'" line).

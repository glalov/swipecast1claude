-- Project verification for creator-posted castings (2026-09-28).
--
-- When a CD submits a casting they now say WHO is making it (production
-- company / student / independent creator), give proof the project exists,
-- say HOW auditions happen, and confirm the audition standards. The admin
-- reviews all of it before publishing, and can send the casting back with a
-- "Needs more info" note that the CD sees on their dashboard (no email).
--
-- Public vs private split:
--   castings.creator_path, castings.audition_mode  -> shown to actors (label chips)
--   casting_verifications.*                         -> proof, venue address, admin note:
--                                                      readable only by the CD and admins
--   storage bucket casting-verification             -> private uploads (intro video, ID, COI…)
--   proof_email_codes                               -> company/school email codes; the edge
--                                                      function proof-email-code writes it

-- 1. Public fields on castings + the two review statuses -----------------------
alter table public.castings
  add column if not exists creator_path  text check (creator_path in ('company','student','indie')),
  add column if not exists audition_mode text check (audition_mode in ('selftape','virtual','inperson'));

-- 'rejected' was already used by admin_set_casting_status and the Reject button
-- but was missing from this constraint, so rejecting failed. 'needs_info' is new.
alter table public.castings drop constraint if exists castings_status_check;
alter table public.castings add constraint castings_status_check
  check (status in ('draft','open','closed','archived','pending_review','rejected','needs_info'));

-- CDs may not move their own casting INTO rejected / needs_info (only admins can).
-- They can still resubmit out of either state to pending_review.
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

  new.cd_id := old.cd_id;
  new.featured := old.featured;
  new.admin_verified := old.admin_verified;
  new.is_admin_created := old.is_admin_created;
  new.approved_at := old.approved_at;
  new.live_email_sent_at := old.live_email_sent_at;
  new.live_email_due_at := old.live_email_due_at;
  if new.created_at is distinct from old.created_at and not (new.created_at > now()) then
    new.created_at := old.created_at;
  end if;
  if new.status in ('rejected','needs_info') and new.status is distinct from old.status then
    new.status := old.status;
  end if;
  if old.approved_at is null then
    if new.status = 'open' or new.status = 'closed' or new.status = 'archived' then
      new.status := case when old.status in ('draft','pending_review','rejected','needs_info') then old.status else 'pending_review' end;
    end if;
    new.published := false;
  end if;
  return new;
end;
$function$;

-- 2. Private verification record, one per casting -----------------------------
create table if not exists public.casting_verifications (
  casting_id        uuid primary key references public.castings(id) on delete cascade,
  cd_id             uuid not null references public.profiles(id) on delete cascade,
  creator_path      text not null check (creator_path in ('company','student','indie')),
  first_project     boolean,
  proofs            jsonb not null default '[]'::jsonb,
  audition_mode     text not null check (audition_mode in ('selftape','virtual','inperson')),
  venue_type        text,
  venue_name        text,
  venue_address     text,
  first_look        boolean,
  standards_ack_at  timestamptz,
  review_note       text,
  review_note_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.casting_verifications enable row level security;

drop policy if exists cv_select on public.casting_verifications;
create policy cv_select on public.casting_verifications for select
  using (cd_id = auth.uid() or public.is_admin());
drop policy if exists cv_insert on public.casting_verifications;
create policy cv_insert on public.casting_verifications for insert
  with check (cd_id = auth.uid()
    and exists (select 1 from public.castings c where c.id = casting_id and c.cd_id = auth.uid()));
drop policy if exists cv_update on public.casting_verifications;
create policy cv_update on public.casting_verifications for update
  using (cd_id = auth.uid() or public.is_admin());
drop policy if exists cv_delete on public.casting_verifications;
create policy cv_delete on public.casting_verifications for delete
  using (public.is_admin());

-- The admin's note is team-only; the CD can read it but never write it.
-- INVOKER on purpose (see castslate-supabase-security-hardening).
create or replace function public.casting_verifications_guard()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at := now();
  if public.cs_write_is_privileged() then return new; end if;
  if tg_op = 'INSERT' then
    new.cd_id := auth.uid();
    new.review_note := null;
    new.review_note_at := null;
  else
    new.cd_id := old.cd_id;
    new.casting_id := old.casting_id;
    new.review_note := old.review_note;
    new.review_note_at := old.review_note_at;
  end if;
  return new;
end;
$function$;
drop trigger if exists casting_verifications_guard on public.casting_verifications;
create trigger casting_verifications_guard before insert or update on public.casting_verifications
  for each row execute function public.casting_verifications_guard();

-- 3. Admin: send a casting back with a note ------------------------------------
create or replace function public.admin_request_casting_info(p_casting_id uuid, p_note text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_was text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'a note for the creator is required'; end if;
  select status into v_was from public.castings where id = p_casting_id;
  if v_was is null then raise exception 'casting not found'; end if;
  update public.castings set status = 'needs_info', published = false where id = p_casting_id;
  insert into public.casting_verifications (casting_id, cd_id, creator_path, audition_mode, review_note, review_note_at)
    select c.id, c.cd_id, coalesce(c.creator_path,'company'), coalesce(c.audition_mode,'selftape'), trim(p_note), now()
    from public.castings c where c.id = p_casting_id
  on conflict (casting_id) do update set review_note = excluded.review_note, review_note_at = excluded.review_note_at;
  perform public._audit('casting.needs_info', 'castings', p_casting_id,
    jsonb_build_object('status', v_was), jsonb_build_object('status','needs_info'), trim(p_note));
end
$function$;
revoke execute on function public.admin_request_casting_info(uuid, text) from public, anon;
grant execute on function public.admin_request_casting_info(uuid, text) to authenticated;

-- 4. Track record: finished castings + reports (self or admin only) ------------
create or replace function public.cd_track_record(p_cd uuid)
 returns table(completed int, reports int)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_cd is distinct from auth.uid() and not public.is_admin() then
    raise exception 'not authorized' using errcode='42501';
  end if;
  return query
  select
    (select count(*)::int from public.castings c
      where c.cd_id = p_cd and c.approved_at is not null
        and not coalesce(c.is_admin_created, false)
        and (c.status in ('closed','archived') or (c.deadline is not null and c.deadline < current_date))),
    (select count(*)::int from public.reports r
      where r.subject_profile_id = p_cd
         or r.subject_casting_id in (select id from public.castings where cd_id = p_cd));
end
$function$;
revoke execute on function public.cd_track_record(uuid) from public, anon;
grant execute on function public.cd_track_record(uuid) to authenticated;

-- 5. Company / school email codes (written only by the edge function) ---------
create table if not exists public.proof_email_codes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  email        text not null,
  kind         text not null check (kind in ('company','school')),
  code_hash    text not null,
  attempts     int  not null default 0,
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists proof_email_codes_user_idx on public.proof_email_codes(user_id, created_at desc);
alter table public.proof_email_codes enable row level security;
drop policy if exists pec_admin_select on public.proof_email_codes;
create policy pec_admin_select on public.proof_email_codes for select using (public.is_admin());

-- 6. Private storage for proof uploads ---------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('casting-verification', 'casting-verification', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists casting_verification_insert on storage.objects;
create policy casting_verification_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'casting-verification' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists casting_verification_select on storage.objects;
create policy casting_verification_select on storage.objects for select to authenticated
  using (bucket_id = 'casting-verification' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists casting_verification_delete on storage.objects;
create policy casting_verification_delete on storage.objects for delete to authenticated
  using (bucket_id = 'casting-verification' and (storage.foldername(name))[1] = auth.uid()::text);

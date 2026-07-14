-- ════════════════════════════════════════════════════════════════════
-- SWIPECAST — database schema
-- Run this ONCE in Supabase → SQL Editor → New query → paste → RUN
-- ════════════════════════════════════════════════════════════════════

-- ───── Helper: detect the site admin ─────
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users
    where auth.users.id = auth.uid()
      and lower(auth.users.email) = 'officecasting01@gmail.com'
  );
$$;

-- ═══════════════════════════════
-- PROFILES
-- One row per auth user. Holds all talent/CD profile data.
-- ═══════════════════════════════
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_type text not null check (user_type in ('talent','cd','admin')),
  display_name text,
  email text,

  -- Talent fields
  bio text,
  age integer,
  gender text,
  ethnicity text,
  location text,
  height text,
  weight text,
  hair text,
  eyes text,
  union_status text,
  agent text,
  skills text[] default '{}',
  training text,
  headshot_url text,
  reel_url text,
  resume_url text,
  additional_photos text[] default '{}',
  video_links text[] default '{}',

  -- Casting director fields
  company_name text,
  company_role text,
  website text,
  credits text,

  -- Shared
  instagram text,
  phone text,

  -- Public profile URL slug (e.g. "lory-becky" → /talent/lory-becky)
  public_slug text unique,

  -- Lifecycle
  onboarded boolean default false,
  visible boolean default true,
  suspended boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists profiles_user_type_idx on public.profiles(user_type);
create index if not exists profiles_location_idx on public.profiles(location);

-- When a user is created in auth.users, automatically create a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, user_type, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'user_type', 'talent'),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ═══════════════════════════════
-- CASTINGS
-- ═══════════════════════════════
create table if not exists public.castings (
  id uuid primary key default gen_random_uuid(),
  cd_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  slug text unique,               -- URL-safe slug, auto-generated from title + id prefix
  type text,
  prod text,
  tagline text,
  synopsis text,
  location text,
  pay text,
  deadline date,
  union_status text,
  status text not null default 'open' check (status in ('draft','open','closed','archived')),
  published boolean default true,
  featured boolean default false,
  has_nudity boolean not null default false,   -- project contains nudity / intimate content
  nudity_details text,                          -- optional CD description of the nudity/intimacy expectations
  go_live_at timestamptz,                       -- scheduled publishing: absolute instant (UTC) the casting becomes public. Chosen in America/New_York wall time, stored as UTC. NULL = live immediately.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists castings_cd_id_idx on public.castings(cd_id);
create index if not exists castings_status_idx on public.castings(status);
create index if not exists castings_type_idx on public.castings(type);
create index if not exists castings_slug_idx on public.castings(slug);
create index if not exists castings_go_live_at_idx on public.castings(go_live_at);

-- ═══════════════════════════════
-- ROLES (a casting has many roles)
-- ═══════════════════════════════
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  casting_id uuid not null references public.castings(id) on delete cascade,
  name text not null,
  description text,
  age_range text,
  gender text,
  ethnicity text,
  pay text,
  created_at timestamptz default now()
);
create index if not exists roles_casting_id_idx on public.roles(casting_id);

-- ═══════════════════════════════
-- APPLICATIONS (talent applies to a role)
-- ═══════════════════════════════
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  casting_id uuid not null references public.castings(id) on delete cascade,
  talent_id uuid not null references public.profiles(id) on delete cascade,
  cover_note text,
  -- Review workflow: pending (unreviewed) → hold | selected | rejected.
  -- Folders in the CD dashboard are just filtered views on this column.
  status text not null default 'pending' check (status in ('pending','hold','selected','rejected')),
  reviewed_at timestamptz,          -- set when CD moves out of 'pending'
  cd_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (role_id, talent_id)       -- prevents an actor from applying twice to the same role
);
create index if not exists applications_casting_id_idx on public.applications(casting_id);
create index if not exists applications_talent_id_idx on public.applications(talent_id);
create index if not exists applications_status_idx on public.applications(status);
create index if not exists applications_casting_status_idx on public.applications(casting_id, status);
create index if not exists applications_role_status_idx on public.applications(role_id, status);

-- ═══════════════════════════════
-- MESSAGES (CD <-> talent)
-- ═══════════════════════════════
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists messages_from_id_idx on public.messages(from_id);
create index if not exists messages_to_id_idx on public.messages(to_id);

-- ═══════════════════════════════
-- REPORTS (for moderation)
-- ═══════════════════════════════
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  subject_profile_id uuid references public.profiles(id) on delete cascade,
  subject_casting_id uuid references public.castings(id) on delete cascade,
  reason text not null,
  details text,
  status text default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz default now()
);

-- ═══════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════
alter table public.profiles enable row level security;
alter table public.castings enable row level security;
alter table public.roles enable row level security;
alter table public.applications enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;

-- ── PROFILES ──
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    (visible = true and suspended = false)
    or id = auth.uid()
    or is_admin()
    -- A CD can always see the profile of anyone who has applied to one of their castings,
    -- even if the applicant's profile is still hidden from the public directory.
    or exists (
      select 1 from public.applications a
      join public.castings c on c.id = a.casting_id
      where a.talent_id = profiles.id
        and c.cd_id = auth.uid()
    )
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid() or is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (is_admin());

-- ── CASTINGS ──
drop policy if exists castings_select on public.castings;
create policy castings_select on public.castings
  for select using (
    -- Archived (filled) castings stay publicly readable so Browse can show them
    -- with a red ARCHIVED stamp instead of having them vanish.
    -- Scheduled publishing: a casting with a future go_live_at stays hidden from
    -- the public until that instant. now() is UTC and compared against the UTC
    -- go_live_at, so the gate opens automatically at the scheduled New York time.
    -- The owner (cd_id) and admins bypass the gate so scheduled castings still
    -- show in their dashboards.
    (published = true and status in ('open','archived') and (go_live_at is null or go_live_at <= now()))
    or cd_id = auth.uid()
    or is_admin()
  );

drop policy if exists castings_insert on public.castings;
create policy castings_insert on public.castings
  for insert with check (
    cd_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.user_type in ('cd','admin'))
  );

drop policy if exists castings_update on public.castings;
create policy castings_update on public.castings
  for update using (cd_id = auth.uid() or is_admin());

drop policy if exists castings_delete on public.castings;
create policy castings_delete on public.castings
  for delete using (cd_id = auth.uid() or is_admin());

-- ── ROLES ──
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select using (
    exists (select 1 from public.castings c where c.id = roles.casting_id and (c.published = true or c.cd_id = auth.uid() or is_admin()))
  );

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert with check (
    exists (select 1 from public.castings c where c.id = roles.casting_id and c.cd_id = auth.uid())
    or is_admin()
  );

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update using (
    exists (select 1 from public.castings c where c.id = roles.casting_id and c.cd_id = auth.uid())
    or is_admin()
  );

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete using (
    exists (select 1 from public.castings c where c.id = roles.casting_id and c.cd_id = auth.uid())
    or is_admin()
  );

-- ── APPLICATIONS ──
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select using (
    talent_id = auth.uid()
    or exists (select 1 from public.castings c where c.id = applications.casting_id and c.cd_id = auth.uid())
    or is_admin()
  );

drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications
  for insert with check (
    talent_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.user_type = 'talent')
  );

drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update using (
    exists (select 1 from public.castings c where c.id = applications.casting_id and c.cd_id = auth.uid())
    or is_admin()
  );

drop policy if exists applications_delete on public.applications;
create policy applications_delete on public.applications
  for delete using (talent_id = auth.uid() or is_admin());

-- ── MESSAGES ──
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (from_id = auth.uid() or to_id = auth.uid() or is_admin());

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (from_id = auth.uid());

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (to_id = auth.uid() or is_admin());

-- ── REPORTS ──
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select using (reporter_id = auth.uid() or is_admin());

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update using (is_admin());

-- ═══════════════════════════════
-- UTIL: updated_at auto-touch
-- ═══════════════════════════════
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute procedure public.touch_updated_at();
drop trigger if exists castings_touch on public.castings;
create trigger castings_touch before update on public.castings for each row execute procedure public.touch_updated_at();
drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications for each row execute procedure public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- STORAGE BUCKETS — run this AFTER you've created the two buckets
-- in the Supabase dashboard:
--   1. Storage → New bucket → Name: "headshots"  → Public bucket: ON
--   2. Storage → New bucket → Name: "reels"      → Public bucket: ON
-- Then come back here and run the rest of this file (the policies).
-- ═══════════════════════════════════════════════════════════════════

-- Anyone can read objects in headshots/reels (they're meant to be public-facing).
drop policy if exists storage_public_read on storage.objects;
create policy storage_public_read on storage.objects
  for select using (bucket_id in ('headshots','reels'));

-- Authenticated users can upload into their own folder (/<user-id>/filename).
drop policy if exists storage_upload_own on storage.objects;
create policy storage_upload_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('headshots','reels')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can update/replace their own files.
drop policy if exists storage_update_own on storage.objects;
create policy storage_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id in ('headshots','reels')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete their own files (and admin can delete anything).
drop policy if exists storage_delete_own on storage.objects;
create policy storage_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('headshots','reels')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Done. You should see "Success. No rows returned."

-- ═══════════════════════════════════════════════════════════════════
-- MIGRATIONS (safe to re-run — add columns that may be missing
-- from existing installs).
-- ═══════════════════════════════════════════════════════════════════
alter table public.profiles     add column if not exists resume_url     text;
alter table public.profiles     add column if not exists video_links    text[] default '{}';
alter table public.applications add column if not exists selected_photo_url text;
alter table public.applications add column if not exists audition_at    timestamptz;
alter table public.applications add column if not exists audition_note  text;
alter table public.applications add column if not exists video_note_url text;

-- Re-apply the profiles select policy so existing installs pick up the new
-- "CD can see profiles of applicants to their castings" clause.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    (visible = true and suspended = false)
    or id = auth.uid()
    or is_admin()
    or exists (
      select 1 from public.applications a
      join public.castings c on c.id = a.casting_id
      where a.talent_id = profiles.id
        and c.cd_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION 2026-04-18 — fix "infinite recursion in policy for relation
-- applications". Idempotent: safe to re-run at any time.
--
-- ROOT CAUSE
-- The previous `profiles_select` policy contained an EXISTS clause that
-- queried `applications`. When a talent INSERTed into `applications`,
-- Postgres evaluated `applications_insert` WITH CHECK, which did
--   `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() ...)`
-- which invoked `profiles_select`, which in turn did
--   `EXISTS (SELECT 1 FROM applications a ...)`
-- and the engine refused because evaluating a policy on `applications`
-- now required selecting from `applications` again → recursion.
--
-- FIX
-- Move cross-table checks into SECURITY DEFINER functions. These run with
-- the function-owner's privileges and BYPASS RLS, so their internal
-- queries don't re-trigger the policies that invoke them. The business
-- rule is unchanged — CDs still see applicant profiles, talent still
-- must have a profile row — but the check no longer loops.
-- ════════════════════════════════════════════════════════════════════

-- Helper: returns profiles.user_type for a given auth user, bypassing RLS.
create or replace function public.user_type_of(p_uid uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select user_type from public.profiles where id = p_uid;
$$;
grant execute on function public.user_type_of(uuid) to authenticated, anon;

-- Helper: does the current CD have an application from this talent? Bypasses RLS.
create or replace function public.cd_has_applicant(p_talent_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.applications a
    join public.castings c on c.id = a.casting_id
    where a.talent_id = p_talent_id
      and c.cd_id = auth.uid()
  );
$$;
grant execute on function public.cd_has_applicant(uuid) to authenticated, anon;

-- ── PROFILES SELECT: replace inline cross-table EXISTS with helper call ──
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    (visible = true and suspended = false)
    or id = auth.uid()
    or is_admin()
    or public.cd_has_applicant(profiles.id)
  );

-- ── APPLICATIONS INSERT: check user_type via helper instead of subquery ──
-- This was the direct trigger of the recursion. WITH CHECK no longer does
-- a protected SELECT on profiles.
drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications
  for insert with check (
    talent_id = auth.uid()
    and public.user_type_of(auth.uid()) in ('talent','admin')
  );

-- ── CASTINGS INSERT: same pattern for consistency (and to prevent a similar
-- recursion if profiles_select ever references castings) ──
drop policy if exists castings_insert on public.castings;
create policy castings_insert on public.castings
  for insert with check (
    cd_id = auth.uid()
    and public.user_type_of(auth.uid()) in ('cd','admin')
  );

-- Done. Re-run this whole file (or just this migration block) in
-- Supabase → SQL Editor → New Query → RUN.

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION 2026-04-19 — admin_system_foundation
--
-- Purpose
-- Give the platform a proper admin layer: role hierarchy, suspension/ban
-- flags, verified/featured badges, site-wide settings, and a tamper-evident
-- audit log. All admin writes go through SECURITY DEFINER RPCs that
-- (a) check authorisation server-side and (b) write an audit_logs row.
--
-- The frontend is a trigger, not a gatekeeper: hiding the admin page in
-- the UI is defence-in-depth only. Every admin action is also rejected
-- by the DB if the caller isn't an admin/super_admin.
-- ════════════════════════════════════════════════════════════════════

-- 1. Extend the user_type vocabulary to include super_admin.
alter table public.profiles drop constraint if exists profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check
  check (user_type in ('talent','cd','admin','super_admin'));

-- 2. Moderation flags on profiles.
alter table public.profiles add column if not exists banned boolean default false;
alter table public.profiles add column if not exists featured boolean default false;
alter table public.profiles add column if not exists verified boolean default false;
alter table public.profiles add column if not exists suspended_reason text;
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists banned_reason text;
alter table public.profiles add column if not exists banned_at timestamptz;

-- 3. Site settings — singleton row, readable to all, writable only via RPC.
create table if not exists public.site_settings (
  id int primary key check (id = 1),
  maintenance_mode boolean default false,
  maintenance_message text,
  support_email text,
  announcement text,
  updated_at timestamptz default now()
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
alter table public.site_settings enable row level security;
drop policy if exists site_settings_select on public.site_settings;
create policy site_settings_select on public.site_settings for select using (true);
-- No insert/update/delete policies → only SECURITY DEFINER RPCs can write.

-- 4. Audit log. Append-only, readable only to admins. No update/delete policy
--    exists, so even admins can't tamper with history from the client.
create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  target_table text,
  target_id text,
  old_value jsonb,
  new_value jsonb,
  note text,
  created_at timestamptz default now()
);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
create index if not exists audit_logs_target_idx on public.audit_logs(target_table, target_id);
alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select using (public.is_admin());

-- 5. Updated is_admin() — now profile-driven, recognises super_admin, and
--    keeps the hard-coded owner email as a fallback so the platform can
--    still recover if the profile row is lost.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.user_type in ('admin','super_admin')
  ) or exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'officecasting01@gmail.com'
  );
$$;

-- 6. is_super_admin() — strictly checks profile role.
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.user_type = 'super_admin'
  );
$$;

-- 7. Internal audit writer — callable only by admin RPCs in this file.
--    `revoke` removes default grants so client code can't call it directly.
create or replace function public._audit(
  p_action text,
  p_table text,
  p_id uuid,
  p_old jsonb,
  p_new jsonb,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_email, action, target_table, target_id, old_value, new_value, note)
  values (auth.uid(), v_email, p_action, p_table, p_id::text, p_old, p_new, p_note);
end;
$$;
revoke all on function public._audit(text,text,uuid,jsonb,jsonb,text) from public, authenticated, anon;

-- 8. Admin RPCs. Each one:
--    • runs as SECURITY DEFINER (so RLS doesn't block legitimate admin writes)
--    • asserts is_admin() / is_super_admin() before doing anything
--    • writes an audit_logs row via _audit()

create or replace function public.admin_set_user_role(p_user_id uuid, p_role text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_role not in ('talent','cd','admin','super_admin') then raise exception 'invalid role: %', p_role; end if;
  select user_type into v_old from public.profiles where id = p_user_id;
  if v_old is null then raise exception 'user not found'; end if;
  if p_role = 'super_admin' and not public.is_super_admin() then
    raise exception 'only super_admin can promote to super_admin' using errcode='42501';
  end if;
  if v_old = 'super_admin' and not public.is_super_admin() then
    raise exception 'only super_admin can change a super_admin role' using errcode='42501';
  end if;
  update public.profiles set user_type = p_role where id = p_user_id;
  perform public._audit('user.role.set','profiles',p_user_id,
    jsonb_build_object('user_type',v_old),
    jsonb_build_object('user_type',p_role), p_note);
end; $$;

create or replace function public.admin_set_user_suspended(p_user_id uuid, p_suspended boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_was boolean; v_target text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select suspended, user_type into v_was, v_target from public.profiles where id = p_user_id;
  if v_target is null then raise exception 'user not found'; end if;
  if v_target = 'super_admin' and not public.is_super_admin() then raise exception 'only super_admin can suspend a super_admin' using errcode='42501'; end if;
  update public.profiles
     set suspended = p_suspended,
         suspended_reason = case when p_suspended then p_reason else null end,
         suspended_at = case when p_suspended then now() else null end
   where id = p_user_id;
  perform public._audit(
    case when p_suspended then 'user.suspend' else 'user.unsuspend' end,
    'profiles', p_user_id,
    jsonb_build_object('suspended',v_was),
    jsonb_build_object('suspended',p_suspended), p_reason);
end; $$;

create or replace function public.admin_set_user_banned(p_user_id uuid, p_banned boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_was boolean; v_target text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select banned, user_type into v_was, v_target from public.profiles where id = p_user_id;
  if v_target is null then raise exception 'user not found'; end if;
  if v_target = 'super_admin' and not public.is_super_admin() then raise exception 'only super_admin can ban a super_admin' using errcode='42501'; end if;
  update public.profiles
     set banned = p_banned,
         banned_reason = case when p_banned then p_reason else null end,
         banned_at = case when p_banned then now() else null end,
         suspended = case when p_banned then true else suspended end
   where id = p_user_id;
  perform public._audit(
    case when p_banned then 'user.ban' else 'user.unban' end,
    'profiles', p_user_id,
    jsonb_build_object('banned',v_was),
    jsonb_build_object('banned',p_banned), p_reason);
end; $$;

create or replace function public.admin_set_user_verified(p_user_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_was boolean;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select verified into v_was from public.profiles where id = p_user_id;
  if v_was is null then raise exception 'user not found'; end if;
  update public.profiles set verified = p_verified where id = p_user_id;
  perform public._audit(
    case when p_verified then 'user.verify' else 'user.unverify' end,
    'profiles', p_user_id,
    jsonb_build_object('verified',v_was),
    jsonb_build_object('verified',p_verified), null);
end; $$;

create or replace function public.admin_set_user_featured(p_user_id uuid, p_featured boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_was boolean;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select featured into v_was from public.profiles where id = p_user_id;
  if v_was is null then raise exception 'user not found'; end if;
  update public.profiles set featured = p_featured where id = p_user_id;
  perform public._audit(
    case when p_featured then 'user.feature' else 'user.unfeature' end,
    'profiles', p_user_id,
    jsonb_build_object('featured',v_was),
    jsonb_build_object('featured',p_featured), null);
end; $$;

create or replace function public.admin_set_casting_featured(p_casting_id uuid, p_featured boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  update public.castings set featured = p_featured, updated_at = now() where id = p_casting_id;
  perform public._audit('set_casting_featured','castings',p_casting_id::text,null,jsonb_build_object('featured',p_featured),null);
end; $$;

create or replace function public.admin_set_casting_status(p_casting_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  if p_status not in ('draft','open','closed','archived') then raise exception 'invalid status'; end if;
  select status into v_old from public.castings where id = p_casting_id;
  update public.castings
     set status = p_status, published = (p_status = 'open'), updated_at = now()
   where id = p_casting_id;
  perform public._audit('set_casting_status','castings',p_casting_id::text,
    jsonb_build_object('status',v_old),jsonb_build_object('status',p_status),null);
end; $$;

create or replace function public.admin_set_application_status(p_application uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  if p_status not in ('pending','hold','selected','rejected') then raise exception 'invalid status'; end if;
  select status into v_old from public.applications where id = p_application;
  update public.applications
     set status = p_status,
         reviewed_at = case when p_status <> 'pending' then now() else null end,
         updated_at = now()
   where id = p_application;
  perform public._audit('set_application_status','applications',p_application::text,
    jsonb_build_object('status',v_old),jsonb_build_object('status',p_status),null);
end; $$;

create or replace function public.admin_delete_application(p_application uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row jsonb;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select to_jsonb(a) into v_row from public.applications a where id = p_application;
  delete from public.applications where id = p_application;
  perform public._audit('delete_application','applications',p_application::text,v_row,null,null);
end; $$;

create or replace function public.admin_update_site_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select to_jsonb(s) into v_old from public.site_settings s where id = 1;
  update public.site_settings
     set maintenance_mode = coalesce((p_settings->>'maintenance_mode')::boolean, maintenance_mode),
         maintenance_message = coalesce(p_settings->>'maintenance_message', maintenance_message),
         support_email = coalesce(p_settings->>'support_email', support_email),
         announcement = coalesce(p_settings->>'announcement', announcement),
         updated_at = now()
   where id = 1;
  perform public._audit('update_site_settings','site_settings','1',v_old,p_settings,null);
end; $$;

create or replace function public.admin_request_password_reset(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  perform public._audit('request_password_reset','profiles',p_user_id,null,null,'requested');
end; $$;

create or replace function public.admin_delete_profile(p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_target_role text; v_row jsonb;
begin
  if not public.is_super_admin() then raise exception 'only super_admin can delete profiles' using errcode='42501'; end if;
  if p_user_id = auth.uid() then raise exception 'you cannot delete your own profile'; end if;
  select user_type into v_target_role from public.profiles where id = p_user_id;
  if v_target_role is null then raise exception 'user not found'; end if;
  if v_target_role = 'super_admin' then raise exception 'cannot delete another super_admin'; end if;
  select to_jsonb(p) into v_row from public.profiles p where id = p_user_id;
  delete from public.profiles where id = p_user_id;
  perform public._audit('delete_profile','profiles',p_user_id,v_row,null,p_reason);
end; $$;

-- 9. Grant execute on the admin RPCs to authenticated (functions still enforce
--    is_admin() internally, so granting does not weaken security).
grant execute on function public.admin_set_user_role(uuid,text,text)         to authenticated;
grant execute on function public.admin_set_user_suspended(uuid,boolean,text) to authenticated;
grant execute on function public.admin_set_user_banned(uuid,boolean,text)    to authenticated;
grant execute on function public.admin_set_user_verified(uuid,boolean)       to authenticated;
grant execute on function public.admin_set_user_featured(uuid,boolean)       to authenticated;
grant execute on function public.admin_set_casting_featured(uuid,boolean)      to authenticated;
grant execute on function public.admin_set_casting_status(uuid,text,text)     to authenticated;
grant execute on function public.admin_set_application_status(uuid,text)     to authenticated;
grant execute on function public.admin_delete_application(uuid)              to authenticated;
grant execute on function public.admin_update_site_settings(jsonb)           to authenticated;
grant execute on function public.admin_request_password_reset(uuid)          to authenticated;
grant execute on function public.admin_delete_profile(uuid,text)             to authenticated;

-- 10. Bootstrap: promote the owner email to super_admin so the platform
--     has at least one super user. Safe to re-run.
update public.profiles
   set user_type = 'super_admin', updated_at = now()
 where lower(email) = 'officecasting01@gmail.com'
   and user_type <> 'super_admin';

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION 2026-04-19 — admin_inherits_cd_capabilities
--
-- Root cause
--   castings_insert required user_type in ('cd','admin'). When the owner
--   was bootstrapped to 'super_admin' in admin_system_foundation, that
--   single clause started rejecting their casting inserts. Every other
--   write path (update/delete/roles) already used is_admin(), which
--   already returns true for super_admin — so only the insert gate was
--   broken.
--
-- Fix
--   Introduce is_cd_capable() returning true for {cd, admin, super_admin}
--   and rewrite castings_insert to use it. This makes "post a casting"
--   an inherited superset: admin and super_admin automatically have CD
--   posting powers, without duplicating accounts.
--
-- Security
--   - Talent-only capabilities (applications_insert) remain gated to
--     user_type = 'talent' — admins do NOT become actors.
--   - Admin-only capabilities (admin_* RPCs) remain gated to is_admin()
--     — CDs do NOT get admin powers.
--   - The inheritance is one-way: admin ⊇ CD, but CD ⊄ admin.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.is_cd_capable()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.user_type in ('cd','admin','super_admin')
  );
$$;
grant execute on function public.is_cd_capable() to authenticated, anon;

drop policy if exists castings_insert on public.castings;
create policy castings_insert on public.castings
  for insert with check (
    cd_id = auth.uid()
    and public.is_cd_capable()
  );

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert with check (
    exists (select 1 from public.castings c where c.id = roles.casting_id and c.cd_id = auth.uid())
    or public.is_admin()
  );

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION 2026-05-09 — submit_application with plan-aware daily cap
--
-- Adds a SECURITY DEFINER RPC that:
--   1. Enforces a daily submission cap based on membership_status:
--        free (no active plan)  → 3 submissions per UTC day
--        active (Premium)       → unlimited
--   2. Prevents duplicate applications to the same role.
--   3. Inserts into applications — bypasses RLS so the recursive-policy
--      bug from the previous applications_insert cannot trigger.
--
-- Frontend calls: window.sb.rpc("submit_application", {p_casting, p_role, p_cover, p_photo})
-- ════════════════════════════════════════════════════════════════════

create or replace function public.submit_application(
  p_casting   uuid,
  p_role      uuid,
  p_cover     text default null,
  p_photo     text default null,
  p_video_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership text;
  v_daily_limit int;
  v_today_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- resolve membership status; default to free if not set
  select coalesce(membership_status, 'free')
    into v_membership
    from public.profiles
   where id = auth.uid();

  -- premium members get a very large cap (effectively unlimited)
  v_daily_limit := case when v_membership = 'active' then 2147483647 else 3 end;

  -- count submissions since the start of today (UTC).
  -- date_trunc('day', now()) keeps the result as timestamptz so the
  -- comparison with created_at (also timestamptz) is always UTC-anchored
  -- regardless of the session timezone.
  select count(*)
    into v_today_count
    from public.applications
   where talent_id  = auth.uid()
     and created_at >= date_trunc('day', now());

  if v_today_count >= v_daily_limit then
    raise exception 'daily submission limit reached' using errcode = 'P0001';
  end if;

  -- prevent duplicate apply to the same role
  if exists (
    select 1 from public.applications
     where talent_id = auth.uid() and role_id = p_role
  ) then
    raise exception 'already submitted to this role' using errcode = '23505';
  end if;

  insert into public.applications (casting_id, role_id, talent_id, cover_note, selected_photo_url, video_note_url)
  values (p_casting, p_role, auth.uid(), p_cover, p_photo, p_video_url);
end;
$$;

-- The old 4-arg overload was dropped (2026-05-27) to eliminate PostgreSQL
-- ambiguity that caused PostgREST to call the wrong overload when p_video_url
-- was passed. Only the 5-arg version below is active:
--   drop function public.submit_application(uuid, uuid, text, text);
grant execute on function public.submit_application(uuid, uuid, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION 2026-05-10 — casting_creator_verification
--
-- Purpose
-- Block unverified casting directors/producers from publishing castings.
-- Adds a full verification state machine to profiles and secure admin
-- RPCs for approve/reject/needs_review/reset.
-- Also adds a user-facing RPC so the frontend can start a verification
-- session without granting the user any self-approval power.
--
-- Policy change
-- castings_insert now requires can_post_castings = true OR is_admin().
-- Existing castings are unaffected (published flag stays).
-- ════════════════════════════════════════════════════════════════════

-- 1. New verification columns on profiles.
alter table public.profiles add column if not exists verification_status        text not null default 'not_started' check (verification_status in ('not_started','pending','verified','rejected','needs_review'));
alter table public.profiles add column if not exists verification_provider      text;
alter table public.profiles add column if not exists verification_session_id    text;
alter table public.profiles add column if not exists identity_verified          boolean not null default false;
alter table public.profiles add column if not exists background_check_status    text not null default 'not_started' check (background_check_status in ('not_started','pending','passed','failed','needs_review'));
alter table public.profiles add column if not exists can_post_castings          boolean not null default false;
alter table public.profiles add column if not exists verification_submitted_at  timestamptz;
alter table public.profiles add column if not exists verification_approved_at   timestamptz;
alter table public.profiles add column if not exists verification_rejected_at   timestamptz;
alter table public.profiles add column if not exists verification_notes         text;
create index if not exists profiles_verification_status_idx on public.profiles(verification_status);
create index if not exists profiles_can_post_castings_idx   on public.profiles(can_post_castings);

-- 2. Helper: is this user fully cleared to post?
--    Bypasses RLS; used in the new castings_insert policy.
create or replace function public.can_post_castings_check()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.can_post_castings = true
      and p.identity_verified  = true
      and p.verification_status = 'verified'
  );
$$;
grant execute on function public.can_post_castings_check() to authenticated, anon;

-- 3. Tighten castings_insert: CD/admin role is necessary but not sufficient —
--    the user also needs a verified posting clearance (or must be admin/super_admin).
drop policy if exists castings_insert on public.castings;
create policy castings_insert on public.castings
  for insert with check (
    cd_id = auth.uid()
    and public.is_cd_capable()
    and (public.is_admin() or public.can_post_castings_check())
  );

-- 4. User-facing RPC: start_verification_session
--    Sets verification_status → pending and records submitted_at.
--    Does NOT grant verification. Provider integration happens externally.
create or replace function public.start_verification_session(p_provider text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Only CD-capable accounts can start verification.
  if not public.is_cd_capable() then
    raise exception 'only casting director accounts can start verification' using errcode = '42501';
  end if;
  -- Verified accounts do not need to restart.
  if exists (select 1 from public.profiles where id = auth.uid() and verification_status = 'verified') then
    raise exception 'account already verified' using errcode = 'P0001';
  end if;
  update public.profiles
     set verification_status       = 'pending',
         verification_provider     = coalesce(p_provider, verification_provider),
         verification_submitted_at = coalesce(verification_submitted_at, now()),
         updated_at                = now()
   where id = auth.uid();
end;
$$;
grant execute on function public.start_verification_session(text) to authenticated;

-- 5. Admin RPC: approve a casting creator.
create or replace function public.admin_approve_casting_creator(p_user_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(p) into v_old from public.profiles p where id = p_user_id;
  if v_old is null then raise exception 'user not found'; end if;
  update public.profiles
     set verification_status      = 'verified',
         identity_verified        = true,
         can_post_castings        = true,
         verified                 = true,
         verification_approved_at = now(),
         verification_rejected_at = null,
         verification_notes       = coalesce(p_notes, verification_notes),
         updated_at               = now()
   where id = p_user_id;
  perform public._audit('cd.verification.approve','profiles',p_user_id,v_old,
    jsonb_build_object('verification_status','verified','can_post_castings',true),p_notes);
end; $$;
grant execute on function public.admin_approve_casting_creator(uuid,text) to authenticated;

-- 6. Admin RPC: reject a casting creator.
create or replace function public.admin_reject_casting_creator(p_user_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(p) into v_old from public.profiles p where id = p_user_id;
  if v_old is null then raise exception 'user not found'; end if;
  update public.profiles
     set verification_status      = 'rejected',
         identity_verified        = false,
         can_post_castings        = false,
         verified                 = false,
         verification_rejected_at = now(),
         verification_approved_at = null,
         verification_notes       = coalesce(p_notes, verification_notes),
         updated_at               = now()
   where id = p_user_id;
  perform public._audit('cd.verification.reject','profiles',p_user_id,v_old,
    jsonb_build_object('verification_status','rejected','can_post_castings',false),p_notes);
end; $$;
grant execute on function public.admin_reject_casting_creator(uuid,text) to authenticated;

-- 7. Admin RPC: flag a casting creator for manual review.
create or replace function public.admin_needs_review_casting_creator(p_user_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(p) into v_old from public.profiles p where id = p_user_id;
  if v_old is null then raise exception 'user not found'; end if;
  update public.profiles
     set verification_status      = 'needs_review',
         can_post_castings        = false,
         verification_notes       = coalesce(p_notes, verification_notes),
         updated_at               = now()
   where id = p_user_id;
  perform public._audit('cd.verification.needs_review','profiles',p_user_id,v_old,
    jsonb_build_object('verification_status','needs_review','can_post_castings',false),p_notes);
end; $$;
grant execute on function public.admin_needs_review_casting_creator(uuid,text) to authenticated;

-- 8. Admin RPC: reset a casting creator's verification to not_started.
create or replace function public.admin_reset_casting_verification(p_user_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(p) into v_old from public.profiles p where id = p_user_id;
  if v_old is null then raise exception 'user not found'; end if;
  update public.profiles
     set verification_status      = 'not_started',
         identity_verified        = false,
         background_check_status  = 'not_started',
         can_post_castings        = false,
         verified                 = false,
         verification_provider    = null,
         verification_session_id  = null,
         verification_submitted_at= null,
         verification_approved_at = null,
         verification_rejected_at = null,
         verification_notes       = coalesce(p_notes, null),
         updated_at               = now()
   where id = p_user_id;
  perform public._audit('cd.verification.reset','profiles',p_user_id,v_old,
    jsonb_build_object('verification_status','not_started','can_post_castings',false),p_notes);
end; $$;
grant execute on function public.admin_reset_casting_verification(uuid,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 2026-05-10 — account_settings_fields
-- Adds account status, deactivation, deletion, and notification
-- preference columns to profiles.
-- Safe to re-run: all ADD COLUMN IF NOT EXISTS.
-- After running, execute: NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists account_status          text        not null default 'active',
  add column if not exists deactivated_at          timestamptz,
  add column if not exists deletion_requested_at   timestamptz,
  add column if not exists deleted_at              timestamptz,
  add column if not exists notification_email      boolean     not null default true,
  add column if not exists notification_applications boolean   not null default true,
  add column if not exists notification_messages   boolean     not null default true,
  add column if not exists notification_marketing  boolean     not null default false,
  add column if not exists notification_sms        boolean     not null default false;

comment on column public.profiles.account_status is
  'Lifecycle status: active | deactivated | deletion_requested | deleted';
comment on column public.profiles.notification_sms is
  'Whether the user has opted in to SMS/text notifications — requires phone number and explicit consent';

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: stripe_membership_integration
-- Adds Stripe payment tracking to profiles and class_booking_requests.
-- Already applied via Supabase MCP — included here for documentation.
-- ═══════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists membership_status      text not null default 'free',
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status    text,
  add column if not exists premium_started_at     timestamptz,
  add column if not exists current_period_end     timestamptz;

create index if not exists profiles_membership_status_idx  on public.profiles(membership_status);
create index if not exists profiles_stripe_customer_id_idx on public.profiles(stripe_customer_id);

alter table public.class_booking_requests
  add column if not exists stripe_session_id text,
  add column if not exists payment_status    text;

comment on column public.profiles.membership_status      is 'free | active';
comment on column public.profiles.subscription_status    is 'active | trialing | past_due | canceled | unpaid';
comment on column public.profiles.stripe_customer_id     is 'Stripe customer ID (cus_...)';
comment on column public.profiles.stripe_subscription_id is 'Stripe subscription ID (sub_...)';
comment on column public.profiles.premium_started_at     is 'When the user first became Premium';
comment on column public.profiles.current_period_end     is 'End of current billing period';

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION 2026-05-27 — audition_instructions
-- Adds per-role audition instructions so CDs can specify exactly how
-- they want talent to audition. Talent submit a video audition rather
-- than a generic headshot-only application.
-- Safe to re-run: all ADD COLUMN IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════
alter table public.roles
  add column if not exists sides_text           text,
  add column if not exists direction_notes      text,
  add column if not exists slate_instructions   text,
  add column if not exists video_length_limit   int default 120,
  add column if not exists audition_deadline    date,
  add column if not exists wardrobe_notes       text,
  add column if not exists submission_type      text not null default 'both'
    check (submission_type in ('upload','record','both')),
  add column if not exists allow_multiple_takes boolean not null default true;

comment on column public.roles.sides_text           is 'Scene or sides text for the audition';
comment on column public.roles.direction_notes      is 'Performance direction and tone notes for the CD';
comment on column public.roles.slate_instructions   is 'How to slate at the start of the audition video';
comment on column public.roles.video_length_limit   is 'Maximum audition video length in seconds (default 120)';
comment on column public.roles.audition_deadline    is 'Optional role-specific submission deadline';
comment on column public.roles.wardrobe_notes       is 'Optional wardrobe and framing guidance';
comment on column public.roles.submission_type      is 'upload | record | both — which submission methods are allowed';
comment on column public.roles.allow_multiple_takes is 'Whether talent may re-record and submit a better take';

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION: legal_pages_cms
-- CMS table for editable Privacy Policy and Terms of Use pages.
-- Super admins edit content from Admin → Legal Pages.
-- Public pages fetch and render stored HTML content.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.legal_pages (
  id          serial primary key,
  slug        text not null unique,
  title       text not null,
  content     text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

alter table public.legal_pages enable row level security;

create policy "legal_pages_public_read"
  on public.legal_pages for select using (true);

create policy "legal_pages_admin_write"
  on public.legal_pages for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.admin_upsert_legal_page(
  p_slug text, p_title text, p_content text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.legal_pages (slug, title, content, updated_at, updated_by)
  values (p_slug, p_title, p_content, now(), auth.uid())
  on conflict (slug) do update
    set title = excluded.title, content = excluded.content,
        updated_at = now(), updated_by = auth.uid();
end; $$;

grant execute on function public.admin_upsert_legal_page(text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- MIGRATION: admin_casting_generator
-- Adds admin-created casting support: is_admin_created flag, expiry,
-- posted_by_label, submission_requirements, and generator settings.
-- ════════════════════════════════════════════════════════════════════

-- Extend castings table with admin-creation metadata
alter table public.castings
  add column if not exists is_admin_created       boolean      not null default false,
  add column if not exists expires_at             timestamptz,
  add column if not exists posted_by_label        text,
  add column if not exists submission_requirements text;

create index if not exists castings_is_admin_created_idx on public.castings(is_admin_created);
create index if not exists castings_expires_at_idx       on public.castings(expires_at);

-- Extend site_settings with generator config
alter table public.site_settings
  add column if not exists casting_generator_enabled  boolean not null default false,
  add column if not exists casting_generator_last_run date;

-- Also extend the status check to include pending_review (already used in the app)
alter table public.castings drop constraint if exists castings_status_check;
alter table public.castings add constraint castings_status_check
  check (status in ('draft','open','closed','archived','pending_review'));

-- RPC: toggle generator on/off
create or replace function public.admin_set_casting_generator_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.site_settings
    set casting_generator_enabled = p_enabled, updated_at = now()
  where id = 1;
  perform public._audit(
    'set_casting_generator_enabled','site_settings','1',null,
    jsonb_build_object('casting_generator_enabled',p_enabled),null
  );
end; $$;
grant execute on function public.admin_set_casting_generator_enabled(boolean) to authenticated;

-- RPC: record that drafts were generated (stamps today's date)
create or replace function public.admin_record_casting_generator_run()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.site_settings
    set casting_generator_last_run = current_date, updated_at = now()
  where id = 1;
end; $$;
grant execute on function public.admin_record_casting_generator_run() to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- EMAIL DIGEST SYSTEM
-- ═══════════════════════════════════════════════════════════════

-- Talent casting email preferences (one row per user)
create table if not exists public.email_preferences (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  casting_digest_enabled  boolean     not null default true,
  frequency               text        not null default 'daily'
                                      check (frequency in ('daily','every_other_day','weekly','off')),
  preferred_cities        text[]      not null default '{}',
  preferred_project_types text[]      not null default '{}',
  paid_only               boolean     not null default false,
  union_preference        text        not null default 'any'
                                      check (union_preference in ('union','non_union','any')),
  last_sent_at            timestamptz,
  unsubscribed_at         timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint email_preferences_user_id_key unique (user_id)
);

-- Email digest send log
create table if not exists public.email_digest_logs (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users(id) on delete cascade,
  sent_at              timestamptz not null default now(),
  project_ids_included uuid[]      not null default '{}',
  status               text        not null default 'sent'
                                   check (status in ('sent','failed','skipped')),
  provider_message_id  text,
  error_message        text
);

-- Prevents sending the same casting to the same user twice
create table if not exists public.user_casting_email_history (
  user_id    uuid not null references auth.users(id) on delete cascade,
  casting_id uuid not null references public.castings(id) on delete cascade,
  emailed_at timestamptz not null default now(),
  primary key (user_id, casting_id)
);

-- Extend site_settings with email digest admin controls
alter table public.site_settings
  add column if not exists digest_emails_enabled boolean not null default true,
  add column if not exists digest_min_projects   integer not null default 5,
  add column if not exists digest_send_hour      integer not null default 7,
  add column if not exists digest_paused         boolean not null default false;

-- Master switch for the front-end Classes section (Admin → Toggles).
-- When false: Classes nav links, footer link, and the /classes page are hidden.
alter table public.site_settings
  add column if not exists classes_section_enabled boolean not null default true;

create or replace function public.admin_set_classes_section(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;
  select to_jsonb(s) into v_old from public.site_settings s where id = 1;
  update public.site_settings set classes_section_enabled = p_enabled, updated_at = now() where id = 1;
  perform public._audit('set_classes_section','site_settings','1',v_old,jsonb_build_object('classes_section_enabled',p_enabled),null);
end; $$;
grant execute on function public.admin_set_classes_section(boolean) to authenticated;

-- ── RLS ────────────────────────────────────────────────────────

alter table public.email_preferences          enable row level security;
alter table public.email_digest_logs          enable row level security;
alter table public.user_casting_email_history enable row level security;

-- Users can read + write their own preferences
create policy "email_prefs: own select"
  on public.email_preferences for select using (user_id = auth.uid());
create policy "email_prefs: own insert"
  on public.email_preferences for insert with check (user_id = auth.uid());
create policy "email_prefs: own update"
  on public.email_preferences for update using (user_id = auth.uid());

-- Admins can read all digest logs
create policy "digest_logs: admin select"
  on public.email_digest_logs for select using (public.is_admin());

-- Users can see their own casting email history
create policy "casting_email_history: own select"
  on public.user_casting_email_history for select using (user_id = auth.uid());

-- Indexes for performance
create index if not exists email_preferences_user_id_idx on public.email_preferences (user_id);
create index if not exists email_digest_logs_user_id_idx on public.email_digest_logs (user_id);
create index if not exists email_digest_logs_sent_at_idx on public.email_digest_logs (sent_at desc);
create index if not exists user_casting_email_history_user_idx on public.user_casting_email_history (user_id);

-- ═══════════════════════════════════════════════════════════════
-- WEEKLY ACTOR CHECK-INS (v1)
-- Automatic one-way weekly career notes delivered to talent inbox.
-- No reply allowed. One per talent per week. Safe, branded content.
-- ═══════════════════════════════════════════════════════════════

-- message_type column on messages table (distinguishes system/check-in from direct)
alter table public.messages
  add column if not exists message_type text not null default 'direct',
  add column if not exists checkin_week date;

-- attachments: jsonb array of {url,name,size,type,path}. Lets casting-side senders
-- (CDs and admin casting-generator personas) attach files — e.g. a sides PDF for a
-- self-tape — that the talent recipient can download from their inbox. Files are
-- stored in the public `casting-media` bucket under the sender's own uid folder
-- (matching that bucket's INSERT RLS: (storage.foldername(name))[1] = auth.uid()).
alter table public.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Log of sent weekly check-ins: one row per (talent, week); unique prevents duplicates
create table if not exists public.weekly_checkin_logs (
  id                 uuid primary key default gen_random_uuid(),
  talent_id          uuid not null references public.profiles(id) on delete cascade,
  message_id         uuid references public.messages(id) on delete set null,
  week_start         date not null,
  status             text not null default 'sent' check (status in ('sent','read','task_completed')),
  task_action        text,
  sent_at            timestamptz default now(),
  read_at            timestamptz,
  task_completed_at  timestamptz,
  constraint weekly_checkin_logs_one_per_week unique (talent_id, week_start)
);

create index if not exists weekly_checkin_logs_talent_idx  on public.weekly_checkin_logs (talent_id);
create index if not exists weekly_checkin_logs_week_idx    on public.weekly_checkin_logs (week_start desc);

alter table public.weekly_checkin_logs enable row level security;

drop policy if exists "checkin_logs: own select"     on public.weekly_checkin_logs;
drop policy if exists "checkin_logs: admin insert"   on public.weekly_checkin_logs;
drop policy if exists "checkin_logs: own update"     on public.weekly_checkin_logs;
drop policy if exists "checkin_logs: admin select"   on public.weekly_checkin_logs;

create policy "checkin_logs: own select"
  on public.weekly_checkin_logs for select
  using (talent_id = auth.uid() or public.is_admin());

create policy "checkin_logs: admin insert"
  on public.weekly_checkin_logs for insert
  with check (public.is_admin());

create policy "checkin_logs: own update"
  on public.weekly_checkin_logs for update
  using (talent_id = auth.uid() or public.is_admin());

-- Admin settings for weekly check-ins (stored in the singleton site_settings row)
alter table public.site_settings
  add column if not exists checkin_enabled           boolean not null default true,
  add column if not exists checkin_send_day          integer not null default 1,
  add column if not exists checkin_send_hour         integer not null default 9,
  add column if not exists checkin_test_mode         boolean not null default false,
  add column if not exists checkin_paused            boolean not null default false,
  add column if not exists checkin_last_run_at       timestamptz,
  add column if not exists checkin_paused_user_ids   jsonb not null default '[]'::jsonb,
  add column if not exists checkin_one_time_send_at  timestamptz,
  add column if not exists checkin_one_time_status   text,
  add column if not exists checkin_one_time_scheduled_at timestamptz,
  add column if not exists checkin_one_time_triggered_at timestamptz;

create or replace function public.admin_set_manager_mode_checkins(p_enabled boolean, p_run_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_result jsonb;
  v_jobname text := 'weekly-checkins-one-time';
  v_schedule text;
  v_command text := $cron$
select net.http_post(
  url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/weekly-checkin-run',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body    := jsonb_build_object('secret', (select value from public.app_secrets where key='checkin_cron_secret')),
  timeout_milliseconds := 280000
);
update public.site_settings
   set checkin_one_time_status = 'triggered',
       checkin_one_time_triggered_at = now(),
       updated_at = now()
 where id = 1;
select cron.unschedule('weekly-checkins-one-time')
 where exists (select 1 from cron.job where jobname = 'weekly-checkins-one-time');
$cron$;
begin
  if not public.is_admin() then raise exception 'not authorised'; end if;

  select to_jsonb(s) into v_old from public.site_settings s where id = 1;

  if exists (select 1 from cron.job where jobname = v_jobname) then
    perform cron.unschedule(v_jobname);
  end if;

  if p_enabled and p_run_at is not null then
    if p_run_at <= now() + interval '1 minute' then
      raise exception 'scheduled time must be at least 1 minute in the future';
    end if;

    v_schedule := format('%s %s %s %s *',
      extract(minute from p_run_at at time zone 'UTC')::int,
      extract(hour from p_run_at at time zone 'UTC')::int,
      extract(day from p_run_at at time zone 'UTC')::int,
      extract(month from p_run_at at time zone 'UTC')::int
    );
    perform cron.schedule(v_jobname, v_schedule, v_command);

    update public.site_settings
       set checkin_enabled = true,
           checkin_paused = false,
           checkin_one_time_send_at = p_run_at,
           checkin_one_time_status = 'scheduled',
           checkin_one_time_scheduled_at = now(),
           checkin_one_time_triggered_at = null,
           updated_at = now()
     where id = 1;
  elsif p_enabled then
    update public.site_settings
       set checkin_enabled = true,
           checkin_paused = false,
           checkin_one_time_send_at = null,
           checkin_one_time_status = null,
           checkin_one_time_scheduled_at = null,
           checkin_one_time_triggered_at = null,
           updated_at = now()
     where id = 1;
  else
    update public.site_settings
       set checkin_enabled = false,
           checkin_paused = false,
           checkin_one_time_send_at = null,
           checkin_one_time_status = case when checkin_one_time_status = 'scheduled' then 'cancelled' else checkin_one_time_status end,
           updated_at = now()
     where id = 1;
  end if;

  perform public._audit(
    'set_manager_mode_checkins',
    'site_settings',
    '1',
    v_old,
    jsonb_build_object('checkin_enabled', p_enabled, 'checkin_one_time_send_at', p_run_at),
    null
  );

  select to_jsonb(s) into v_result from public.site_settings s where id = 1;
  return v_result;
end; $$;

grant execute on function public.admin_set_manager_mode_checkins(boolean,timestamptz) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- NEWS SECTION (2026-06-03) — landing-page industry news
-- Auto-fetched from approved trade RSS feeds, rewritten by CastSlate Staff,
-- paired with royalty-free imagery, always linked back to the source.
-- Applied via migration `news_section_2026_06_03`.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.news_articles (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  headline    text not null,
  excerpt     text,
  body        text,
  category    text not null default 'Industry'
              check (category in ('Casting','Film','Theater','Industry','Actors')),
  image_url   text,
  source_name text,
  source_url  text,
  author      text not null default 'CastSlate Staff',
  status      text not null default 'published'
              check (status in ('draft','published','archived')),
  published   boolean not null default true,
  fetched_at  timestamptz default now(),
  written_at  timestamptz default now(),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists news_articles_pub_idx on public.news_articles (published, status, written_at desc);
create index if not exists news_articles_cat_idx on public.news_articles (category);
alter table public.news_articles enable row level security;
drop policy if exists news_articles_public_read on public.news_articles;
create policy news_articles_public_read on public.news_articles
  for select using (published = true and status = 'published');
drop policy if exists news_articles_admin_all on public.news_articles;
create policy news_articles_admin_all on public.news_articles
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.site_settings
  add column if not exists news_section_enabled      boolean     not null default true,
  add column if not exists news_auto_refresh_enabled boolean     not null default false,
  add column if not exists news_refresh_weeks         int        not null default 2,
  add column if not exists news_last_run             timestamptz;

-- RPCs: admin_set_news_section_enabled / admin_set_news_auto_refresh /
-- admin_record_news_run (mirror casting-generator toggles; is_admin()-gated).
-- Auto-refresh: public.run_news_auto_refresh() invoked daily by pg_cron job
-- 'news-auto-refresh-daily'; fires the news-refresh edge function via pg_net
-- using the service-role key stored in Vault secret 'news_service_role_key'.
-- See migrations `news_section_2026_06_03` and `news_auto_refresh_cron`.

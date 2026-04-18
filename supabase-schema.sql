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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists castings_cd_id_idx on public.castings(cd_id);
create index if not exists castings_status_idx on public.castings(status);
create index if not exists castings_type_idx on public.castings(type);

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
  status text not null default 'submitted' check (status in ('submitted','viewed','passed','callback','booked','rejected')),
  cd_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (role_id, talent_id)
);
create index if not exists applications_casting_id_idx on public.applications(casting_id);
create index if not exists applications_talent_id_idx on public.applications(talent_id);
create index if not exists applications_status_idx on public.applications(status);

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
    (published = true and status = 'open')
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

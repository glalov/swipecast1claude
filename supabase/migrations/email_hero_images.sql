-- Rotating film-still hero for the daily digest and the noon/evening premium
-- upsell. Before this, the digest hard-coded /email/digest-hero.jpg, so every
-- recipient saw the same picture every day forever, and the upsell had no hero
-- at all. Each row carries its own look: `style` picks the template variant
-- (light editorial vs dark cinema) and `accent` is sampled from the image, so
-- the email is themed to whatever still it is showing that day.

create table if not exists public.email_hero_images (
  id           uuid primary key default gen_random_uuid(),
  -- where the image came from, so licence questions stay answerable later
  source       text not null check (source in ('tmdb','public_domain','own')),
  title        text not null,
  year         int,
  image_url    text not null,
  -- the line printed under the still
  caption      text not null,
  -- template variant: 'marquee' = cream/ink editorial, 'latenight' = dark cinema.
  -- Chosen from the still's mean luminance at curation time.
  style        text not null default 'marquee' check (style in ('marquee','latenight')),
  -- most saturated usable colour sampled from the still
  accent       text not null default '#F0B860',
  credit       text,
  active       boolean not null default true,
  last_used_at timestamptz,
  use_count    int not null default 0,
  created_at   timestamptz not null default now()
);

-- The rotation is least-recently-used, which is what makes "a new one every
-- day" true: an image cannot come back until every other active image has been
-- shown. Three sends a day therefore never collide as long as the pool is >= 3.
create index if not exists email_hero_images_rotation_idx
  on public.email_hero_images (active, last_used_at nulls first);

create or replace function public.get_next_email_hero()
returns public.email_hero_images
language plpgsql
security definer
set search_path = public
as $$
declare picked public.email_hero_images;
begin
  update public.email_hero_images
     set last_used_at = now(), use_count = use_count + 1
   where id = (
     select id from public.email_hero_images
      where active
      order by last_used_at nulls first, random()
      limit 1
      for update skip locked
   )
  returning * into picked;
  return picked;  -- null when the pool is empty; callers fall back to the static hero
end $$;

alter table public.email_hero_images enable row level security;

-- Only the edge functions (service_role, which bypasses RLS) rotate these.
-- New functions are granted EXECUTE to anon/authenticated by default, which
-- would let anyone burn through the rotation — revoke it explicitly.
revoke all on function public.get_next_email_hero() from public, anon, authenticated;

-- Super admins read the pool for the admin screen; nobody else sees it.
drop policy if exists email_hero_images_admin_read on public.email_hero_images;
create policy email_hero_images_admin_read on public.email_hero_images
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'super_admin'));

-- Off until the pool is seeded and verified; the digest keeps its static hero
-- while this is false.
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
alter table public.site_settings
  add column if not exists hero_rotation_enabled boolean not null default false;

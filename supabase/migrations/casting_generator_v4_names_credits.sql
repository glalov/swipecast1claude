-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: casting_generator_v4_names_credits  (2026-09-16, round 2)
-- 1. castings.crew_credits — crew credits in their own field
--    ("Director: Name · Producer: Name · Casting: Name"), never in the company
--    name or the submission requirements.
-- 2. casting_generator_seen.meta + kind 'person_name' — every character and
--    crew full name ever generated, key 'person|<lowercase, accents stripped>'.
--    The primary key on `key` is the unique constraint: the admin page inserts
--    these rows BEFORE saving a draft, so two admins generating at the same
--    time cannot both take a name. meta = {first,last,project,at} drives the
--    50-project first-name / surname cooldown.
-- 3. Backfill every name on every existing admin-generated casting.
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists unaccent;

alter table public.castings add column if not exists crew_credits text;
alter table public.casting_generator_seen add column if not exists meta jsonb;

alter table public.casting_generator_seen drop constraint if exists casting_generator_seen_kind_check;
alter table public.casting_generator_seen add constraint casting_generator_seen_kind_check
  check (kind is null or kind in ('story','backfill','character_name','crew_name','company','schedule_note','area','person_name'));

create or replace function public.acg_norm_name(n text) returns text
language sql immutable as $$
  select btrim(regexp_replace(lower(public.unaccent(coalesce(n,''))), '[^a-z0-9]+', ' ', 'g'))
$$;

with people as (
  -- characters
  select r.name as full_name, c.id as project, c.created_at
  from public.roles r join public.castings c on c.id = r.casting_id
  where c.is_admin_created
    and r.name ~ '^[A-Z][A-Za-z''’.-]+( [A-Z][A-Za-z''’.-]+){1,2}$'
    and r.name !~* '(background|stand-in|double|ensemble|patrons|regulars|guests|riders|audience|crew|customers|students|voices|people|passersby|performer|driver)'
  union all
  -- casting directors stored as a person
  select c.casting_director_name, c.id, c.created_at
  from public.castings c
  where c.is_admin_created and c.casting_director_name ~ '^[A-Z][A-Za-z''’.-]+( [A-Z][A-Za-z''’.-]+){1,2}$'
  union all
  -- crew credited inside the old company line: "Company — Casting Name · Dir. Name"
  select btrim(regexp_replace(part, '^(Voice |Capture |Show |Music |Creative |Session |Stage )?(Director|Producer|Writer|Photographer|Showrunner|Choreographer|Casting Director|Casting|Manager|Prod\.|Dir\.)\s+', '')), c.id, c.created_at
  from public.castings c,
       lateral unnest(string_to_array(split_part(coalesce(c.prod,''), ' — ', 2), ' · ')) as part
  where c.is_admin_created
  union all
  -- crew credited in the round-1 "Credits:" sentence
  select btrim(regexp_replace(part, '^(Voice |Capture |Show |Music |Creative |Session |Stage )?(Director|Producer|Writer|Photographer|Showrunner|Choreographer|Casting Director|Casting|Manager)\s+', '')), c.id, c.created_at
  from public.castings c,
       lateral unnest(string_to_array(rtrim(substring(coalesce(c.submission_requirements,'') from 'Credits: (.*)$'), '.'), ' · ')) as part
  where c.is_admin_created
)
insert into public.casting_generator_seen (key, kind, meta, created_at)
select distinct on (public.acg_norm_name(full_name))
       'person|' || public.acg_norm_name(full_name), 'person_name',
       jsonb_build_object('first', split_part(full_name,' ',1),
                          'last', regexp_replace(full_name,'^\S+\s+',''),
                          'project', project::text,
                          'at', (extract(epoch from created_at)*1000)::bigint),
       created_at
from people
where full_name ~ '^[A-Z][A-Za-z''’.-]+( [A-Z][A-Za-z''’.-]+){1,2}$'
order by public.acg_norm_name(full_name), created_at desc
on conflict (key) do nothing;

revoke execute on function public.acg_norm_name(text) from public, anon, authenticated;

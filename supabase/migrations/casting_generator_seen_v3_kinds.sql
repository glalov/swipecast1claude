-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: casting_generator_seen_v3_kinds  (2026-09-16)
-- The Admin Casting Generator's durable no-repeat log. Until now it held story
-- keys only (kind 'story' / 'backfill'); names, companies, schedule notes and
-- neighborhoods lived in each browser's localStorage and reset per device.
-- v3 writes all of them here. Keys carry a prefix that says what they are:
--   name|<clean full name>          kind 'character_name'
--   crew|<clean full name>          kind 'crew_name'
--   company|<clean company core>    kind 'company'      ("copper lantern")
--   sched|<normalized sentence>     kind 'schedule_note' (numbers → #)
--   area|<City>|<Area>|<nonce>      kind 'area'         (one row per use)
-- Un-prefixed keys are story keys, exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.casting_generator_seen (
  key        text primary key,
  kind       text,
  created_at timestamptz default now()
);

alter table public.casting_generator_seen
  drop constraint if exists casting_generator_seen_kind_check;
alter table public.casting_generator_seen
  add constraint casting_generator_seen_kind_check
  check (kind is null or kind in ('story','backfill','character_name','crew_name','company','schedule_note','area'));

create index if not exists casting_generator_seen_kind_idx on public.casting_generator_seen (kind);

comment on table public.casting_generator_seen is
  'Admin Casting Generator durable no-repeat log: story keys plus name|, crew|, company|, sched|, area| prefixed keys (v3, 2026-09-16).';

-- Retire every character name already on an admin-generated listing, using the
-- same normalization the generator uses (lowercase, non-alphanumerics → space).
insert into public.casting_generator_seen (key, kind)
select distinct 'name|' || btrim(regexp_replace(lower(r.name), '[^a-z0-9]+', ' ', 'g')), 'character_name'
from public.roles r
join public.castings c on c.id = r.casting_id
where c.is_admin_created
  and r.name ~ '^[A-Z][A-Za-z''’.-]+( [A-Z][A-Za-z''’.-]+){1,2}$'
  and r.name !~* '(background|stand-in|double|ensemble|patrons|regulars|guests|riders|audience|crew|customers|students|voices|people|passersby)'
on conflict (key) do nothing;

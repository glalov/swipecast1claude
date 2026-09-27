-- Profile stats upgrade (2026-09-26): pick-several ethnicity and union, roles
-- the actor is authentic to, a numeric playable age range, accents, languages.
--
-- The OLD single-value columns stay and are kept in sync by
-- profiles_stats_sync, both ways, so every existing reader (role matcher,
-- castslate-submit-match, emails, check-ins, CD views) keeps working untouched:
--   ethnicities[]       <-> ethnicity      (joined ", ")
--   unions[]            <-> union_status   (joined " / ", the existing format)
--   authentic_genders[] <-> open_to_role_genders (Male/Female/Non-Binary)
--   age_play_min/max    <-> age_range      ("21-30")
-- Skills keep living in profiles.skills (the editor recognises old values).

create table if not exists public.profiles_stats_backup_20260926 as
  select id, ethnicity, union_status, age_range, open_to_role_genders, skills, now() as backed_up_at
    from public.profiles;

alter table public.profiles
  add column if not exists ethnicities       text[],
  add column if not exists unions            text[],
  add column if not exists authentic_genders text[],
  add column if not exists age_play_min      int,
  add column if not exists age_play_max      int,
  add column if not exists accents           text[],
  add column if not exists languages         text[];

-- Old single ethnicity value -> new pick-several labels.
create or replace function public.cs_map_ethnicity(p text)
 returns text[]
 language sql
 immutable
as $$
  select case coalesce(trim(p), '')
    when '' then null
    when 'White / Caucasian' then array['White']
    when 'Black / African American' then array['Black']
    when 'Latino / Latina / Latinx' then array['Hispanic / Latino']
    when 'Hispanic' then array['Hispanic / Latino']
    when 'Hispanic / Latino' then array['Hispanic / Latino']
    when 'Mixed / Multiracial' then array['Mixed Ethnicity']
    when 'Asian - East Asian' then array['East Asian']
    when 'Asian - South Asian' then array['South Asian']
    when 'Asian - Southeast Asian' then array['Southeast Asian']
    when 'Eastern European' then array['Eastern European']
    when 'Middle Eastern / North African' then array['Middle Eastern','North African']
    when 'Mediterranean' then array['Mediterranean']
    when 'Native American / Indigenous' then array['Indigenous / Native American']
    when 'Pacific Islander' then array['Pacific Islander']
    else null   -- "Other / Prefer to self-describe" and anything unknown stay text-only
  end;
$$;

create or replace function public.cs_role_genders_to_authentic(p text[])
 returns text[]
 language sql
 immutable
as $$
  select case when p is null then null else array(
    select distinct x from (
      select case g when 'Male' then 'Man' when 'Female' then 'Woman' when 'Non-Binary' then 'Nonbinary' end x
        from unnest(p) g) s
     where x is not null order by 1) end;
$$;

create or replace function public.cs_authentic_to_role_genders(p text[])
 returns text[]
 language sql
 immutable
as $$
  select case when p is null then null else array(
    select g from (values ('Male'),('Female'),('Non-Binary')) v(g)
     where (g = 'Male'       and (p && array['Man','Transgender Man']))
        or (g = 'Female'     and (p && array['Woman','Transgender Woman']))
        or (g = 'Non-Binary' and (p && array['Nonbinary']))) end;
$$;

create or replace function public.profiles_stats_sync()
 returns trigger
 language plpgsql
as $function$
declare
  m text[];
  eth_new boolean; uni_new boolean; auth_new boolean; age_new boolean;
begin
  if tg_op = 'INSERT' then
    eth_new := new.ethnicities is not null; uni_new := new.unions is not null;
    auth_new := new.authentic_genders is not null; age_new := new.age_play_min is not null or new.age_play_max is not null;
  else
    eth_new := coalesce(new.ethnicities,'{}') is distinct from coalesce(old.ethnicities,'{}');
    uni_new := coalesce(new.unions,'{}') is distinct from coalesce(old.unions,'{}');
    auth_new := new.authentic_genders is distinct from old.authentic_genders;
    age_new := new.age_play_min is distinct from old.age_play_min or new.age_play_max is distinct from old.age_play_max;
  end if;

  -- Ethnicity
  if eth_new then
    new.ethnicity := nullif(array_to_string(coalesce(new.ethnicities,'{}'), ', '), '');
  elsif tg_op = 'INSERT' or new.ethnicity is distinct from old.ethnicity then
    new.ethnicities := public.cs_map_ethnicity(new.ethnicity);
  end if;

  -- Union
  if uni_new then
    new.union_status := nullif(array_to_string(coalesce(new.unions,'{}'), ' / '), '');
  elsif tg_op = 'INSERT' or new.union_status is distinct from old.union_status then
    new.unions := case when coalesce(trim(new.union_status),'') = '' then null
                       else array(select trim(x) from unnest(string_to_array(new.union_status, '/')) x where trim(x) <> '') end;
  end if;

  -- Roles the actor is authentic to <-> matcher genders
  if auth_new then
    new.open_to_role_genders := public.cs_authentic_to_role_genders(new.authentic_genders);
  elsif tg_op = 'INSERT' or new.open_to_role_genders is distinct from old.open_to_role_genders then
    new.authentic_genders := public.cs_role_genders_to_authentic(new.open_to_role_genders);
  end if;

  -- Playable age range
  if age_new then
    if new.age_play_min is not null and new.age_play_max is not null and new.age_play_min > new.age_play_max then
      m := array[new.age_play_max::text, new.age_play_min::text];
      new.age_play_min := m[1]::int; new.age_play_max := m[2]::int;
    end if;
    new.age_range := case
      when new.age_play_min is not null and new.age_play_max is not null then new.age_play_min || '-' || new.age_play_max
      when new.age_play_min is not null then new.age_play_min || '+'
      else null end;
  elsif tg_op = 'INSERT' or new.age_range is distinct from old.age_range then
    m := regexp_match(coalesce(new.age_range,''), '^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$');
    if m is not null then new.age_play_min := m[1]::int; new.age_play_max := m[2]::int;
    else
      m := regexp_match(coalesce(new.age_range,''), '^\s*(\d{1,3})\s*\+\s*$');
      if m is not null then new.age_play_min := m[1]::int; new.age_play_max := null;
      else new.age_play_min := null; new.age_play_max := null; end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_stats_sync on public.profiles;
create trigger profiles_stats_sync
  before insert or update on public.profiles
  for each row execute function public.profiles_stats_sync();

-- One-time fill of the NEW columns from the old ones. Only the new, empty
-- columns are written; triggers paused so updated_at is not bumped.
set local session_replication_role = replica;
update public.profiles p set
  ethnicities = public.cs_map_ethnicity(p.ethnicity),
  unions = case when coalesce(trim(p.union_status),'') = '' then null
                else array(select trim(x) from unnest(string_to_array(p.union_status, '/')) x where trim(x) <> '') end,
  authentic_genders = public.cs_role_genders_to_authentic(p.open_to_role_genders),
  age_play_min = coalesce((regexp_match(coalesce(p.age_range,''), '^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$'))[1]::int,
                          (regexp_match(coalesce(p.age_range,''), '^\s*(\d{1,3})\s*\+\s*$'))[1]::int),
  age_play_max = (regexp_match(coalesce(p.age_range,''), '^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$'))[2]::int
where p.ethnicities is null and p.unions is null and p.authentic_genders is null and p.age_play_min is null;
set local session_replication_role = origin;

revoke all on table public.profiles_stats_backup_20260926 from anon, authenticated;
alter table public.profiles_stats_backup_20260926 enable row level security;

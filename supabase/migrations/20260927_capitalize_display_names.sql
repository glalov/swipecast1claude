-- Owner request 2026-09-27: names typed all-lowercase ("boris ivanov") are shown
-- capitalized everywhere (emails, profiles, CD views). Only words written entirely
-- in lowercase are touched, so deliberate casing (DeShawn, McKay) is left alone.
-- Applied live via MCP; 146 rows changed, originals in display_name_backup_20260927.
create or replace function public.nice_display_name(p text)
returns text language sql immutable set search_path = public as $$
  select case when p is null then null else
    (select string_agg(case when w ~ '[a-z]' and w = lower(w) then initcap(w) else w end, ' ' order by ord)
       from regexp_split_to_table(btrim(p), '\s+') with ordinality as t(w, ord))
  end;
$$;

create or replace function public.profiles_nice_display_name()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.display_name is not null and new.display_name <> '' then
    new.display_name := public.nice_display_name(new.display_name);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_nice_display_name on public.profiles;
create trigger profiles_nice_display_name
  before insert or update of display_name on public.profiles
  for each row execute function public.profiles_nice_display_name();

create table if not exists public.display_name_backup_20260927 as
  select id, display_name, now() as backed_up_at from public.profiles
  where display_name is not null and display_name is distinct from public.nice_display_name(display_name);
alter table public.display_name_backup_20260927 enable row level security;
revoke all on public.display_name_backup_20260927 from anon, authenticated;
revoke execute on function public.nice_display_name(text) from anon;

update public.profiles p set display_name = public.nice_display_name(p.display_name)
where p.id in (select id from public.display_name_backup_20260927);

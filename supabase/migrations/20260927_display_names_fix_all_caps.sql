-- 2026-09-27 (owner): ALL-CAPS names ("JANKA AMERICA") read as shouting in emails.
-- Same trigger as the lowercase fix (profiles_nice_display_name); now also normal-cases an
-- ALL-CAPS word when it is 3+ letters, has a vowel, and has no digits/dots. Initials and
-- acronyms stay as typed (D, VM, KB, AR, D.E.D., MHG, LLC). 21 rows changed; originals in
-- display_name_caps_backup_20260927.
create or replace function public.nice_display_name(p text)
returns text language sql immutable set search_path = public as $$
  select case when p is null then null else
    (select string_agg(
       case
         when w ~ '[[:lower:]]' and w = lower(w) then initcap(w)
         when w ~ '[[:upper:]]' and w = upper(w)
              and w !~ '[0-9.]'
              and length(regexp_replace(w,'[^[:alpha:]]','','g')) >= 3
              and w ~* '[aeiouyàáâäãåèéêëìíîïòóôöõùúûüý]'
           then initcap(w)
         else w end, ' ' order by ord)
       from regexp_split_to_table(btrim(p), '\s+') with ordinality as t(w, ord))
  end;
$$;
revoke execute on function public.nice_display_name(text) from anon;

create table if not exists public.display_name_caps_backup_20260927 as
  select id, display_name, now() as backed_up_at from public.profiles
  where display_name is not null and display_name is distinct from public.nice_display_name(display_name);
alter table public.display_name_caps_backup_20260927 enable row level security;
revoke all on public.display_name_caps_backup_20260927 from anon, authenticated;

update public.profiles p set display_name = public.nice_display_name(p.display_name)
where p.id in (select id from public.display_name_caps_backup_20260927);

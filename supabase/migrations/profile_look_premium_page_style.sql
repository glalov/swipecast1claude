-- Premium "page look" (2026-10-15): hero header, theme, accent and a one-line description.
-- {hero:bool, theme:'classic'|'cinematic'|'editorial', accent:'teal'|'navy'|'gold'|'terracotta', tagline:text}
-- Applied on the public profile only while membership_status='active'; kept (not deleted) if they cancel.
alter table public.profiles add column if not exists profile_look jsonb;
alter table public.profiles drop constraint if exists profiles_profile_look_tagline_len;
alter table public.profiles add constraint profiles_profile_look_tagline_len
  check (profile_look is null or char_length(coalesce(profile_look->>'tagline','')) <= 90);

-- Same no-contact-info rule as bio/credits, extended to the tagline.
CREATE OR REPLACE FUNCTION public.enforce_no_contact_info()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_table_name = 'profiles' then
    if public.contains_contact_info(new.bio) then
      raise exception 'Links, phone numbers, emails, and social handles are not allowed in bio.' using errcode = '23514';
    end if;
    if public.contains_contact_info(new.credits) then
      raise exception 'Links, phone numbers, emails, and social handles are not allowed in credits.' using errcode = '23514';
    end if;
    if public.contains_contact_info(new.profile_look->>'tagline') then
      raise exception 'Links, phone numbers, emails, and social handles are not allowed in your one-line description.' using errcode = '23514';
    end if;
  elsif tg_table_name = 'applications' then
    if public.contains_contact_info(new.cover_note) then
      raise exception 'Links, phone numbers, emails, and social handles are not allowed in cover_note.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

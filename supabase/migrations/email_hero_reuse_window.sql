-- Test sends and re-runs call get_next_email_hero() too, and each call used to
-- advance the rotation. On 2026-09-11/12 about a dozen previews burned through
-- the 20 new stills, so the real noon/evening sends fell back to old ones.
-- Within 3h of a pick, return that same still instead of advancing.
-- Noon (16:00 UTC) and evening (22:00 UTC) are 6h apart, so they still differ.
create or replace function public.get_next_email_hero()
 returns public.email_hero_images
 language plpgsql security definer set search_path to 'public'
as $function$
declare picked public.email_hero_images;
begin
  select * into picked from public.email_hero_images
   where active and last_used_at > now() - interval '3 hours'
   order by last_used_at desc limit 1;
  if found then return picked; end if;
  update public.email_hero_images
     set last_used_at = now(), use_count = use_count + 1
   where id = (select id from public.email_hero_images where active
               order by last_used_at nulls first, random() limit 1 for update skip locked)
  returning * into picked;
  return picked;
end $function$;

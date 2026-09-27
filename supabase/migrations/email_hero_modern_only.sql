-- 2026-09-26: owner rule — upsell/digest hero stills are modern films only.
-- Old public-domain (silent / B&W) stills deactivated (backup: email_hero_images_backup_20260926)
-- and excluded in the picker, so re-activating one has no effect.
update public.email_hero_images set active = false where source = 'public_domain' and active;

create or replace function public.get_next_email_hero()
 returns email_hero_images
 language plpgsql security definer set search_path to 'public'
as $function$
declare picked public.email_hero_images;
begin
  select * into picked from public.email_hero_images
   where active and source <> 'public_domain' and last_used_at > now() - interval '3 hours'
   order by last_used_at desc limit 1;
  if found then return picked; end if;
  update public.email_hero_images
     set last_used_at = now(), use_count = use_count + 1
   where id = (select id from public.email_hero_images
                where active and source <> 'public_domain'
                order by last_used_at nulls first, random() limit 1 for update skip locked)
  returning * into picked;
  return picked;
end $function$;

-- Size card (2026-09-26). Public wardrobe sizes on the profile, plus PRIVATE
-- answers in their own locked table (profiles is publicly readable, so private
-- data can never live there).
--
--   profiles.size_set       'men' | 'women'  (which size chart the actor uses)
--   profiles.sizes          {"Shirt":"M","Neck":"16.5",...}  labels = SIZE_FIELDS in the jsx
--   profiles.wardrobe_notes free text shown with the size card
--   profile_private         tattoos / piercings / nudity — owner + admin only.
--     get_body_mods(talent) returns tattoos + piercings ONLY to the actor,
--     an admin, or a CD the actor has submitted to (cd_has_applicant).
--     Nudity is never returned to anyone else; the actor's own dashboard reads
--     it to stop recommending nudity castings after an explicit "No".

alter table public.profiles
  add column if not exists size_set text,
  add column if not exists sizes jsonb,
  add column if not exists wardrobe_notes text;

do $$ begin
  alter table public.profiles add constraint profiles_size_set_chk check (size_set is null or size_set in ('men','women'));
exception when duplicate_object then null; end $$;

create table if not exists public.profile_private (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  has_tattoos    boolean,
  has_piercings  boolean,
  nudity_partial boolean,
  nudity_full    boolean,
  updated_at     timestamptz not null default now()
);
alter table public.profile_private enable row level security;

drop policy if exists profile_private_owner_select on public.profile_private;
create policy profile_private_owner_select on public.profile_private
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists profile_private_owner_insert on public.profile_private;
create policy profile_private_owner_insert on public.profile_private
  for insert with check (user_id = auth.uid() or public.is_admin());
drop policy if exists profile_private_owner_update on public.profile_private;
create policy profile_private_owner_update on public.profile_private
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

revoke all on table public.profile_private from anon;
grant select, insert, update on table public.profile_private to authenticated;

create or replace function public.get_body_mods(p_talent uuid)
 returns table(has_tattoos boolean, has_piercings boolean)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return; end if;
  if not (p_talent = auth.uid() or public.is_admin() or public.cd_has_applicant(p_talent)) then return; end if;
  return query select pp.has_tattoos, pp.has_piercings from public.profile_private pp where pp.user_id = p_talent;
end;
$function$;

revoke all on function public.get_body_mods(uuid) from public, anon;
grant execute on function public.get_body_mods(uuid) to authenticated;

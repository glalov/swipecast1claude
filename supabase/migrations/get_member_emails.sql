-- get_digest_emails deliberately excludes membership_status='active' because
-- Premium members do not receive the casting digest. That is a DIGEST policy,
-- not an address lookup, so anything that needs to reach ALL members (product
-- announcements) must not reuse it — doing so silently dropped every Premium
-- member from the first announcement dry run.
--
-- This is the plain lookup: live, non-deleted addresses only. Suppression and
-- opt-out policy stays with the caller. get_digest_emails is UNCHANGED, so the
-- daily digest still excludes Premium exactly as before.
create or replace function public.get_member_emails(uids uuid[])
returns table(id uuid, email text)
language sql
security definer
set search_path to ''
as $function$
  select u.id, u.email::text
  from auth.users u
  where u.id = any(uids)
    and u.email is not null
    and u.email <> ''
    and u.deleted_at is null
$function$;

-- New public functions get EXECUTE for anon/authenticated by default — revoke it.
revoke all on function public.get_member_emails(uuid[]) from public;
revoke all on function public.get_member_emails(uuid[]) from anon;
revoke all on function public.get_member_emails(uuid[]) from authenticated;

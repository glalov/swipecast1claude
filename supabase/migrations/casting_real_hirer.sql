-- Real-hirer flag (2026-10-01). A casting entered from the admin account can be a
-- real job a casting director sent in. The owner ticks "Real casting" for those;
-- they then get the Google Jobs JobPosting data (api/casting-og.js) and the Google
-- Indexing API notice (casting-indexer), same as castings a CD posts themselves.
-- Unticked admin castings (e.g. Casting Generator) never do. Admin-only field.

alter table public.castings add column if not exists real_hirer boolean not null default false;

create or replace function public.castings_guard_admin_fields()
 returns trigger
 language plpgsql
as $function$
begin
  if public.cs_write_is_privileged() then
    if new.status = 'open' and new.approved_at is null then new.approved_at := now(); end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, '') not in ('draft','pending_review') then new.status := 'pending_review'; end if;
    new.published := false;
    new.featured := false;
    new.admin_verified := null;
    new.is_admin_created := false;
    new.real_hirer := false;
    new.approved_at := null;
    new.live_email_sent_at := null;
    new.live_email_due_at := null;
    return new;
  end if;

  new.cd_id := old.cd_id;
  new.featured := old.featured;
  new.admin_verified := old.admin_verified;
  new.is_admin_created := old.is_admin_created;
  new.real_hirer := old.real_hirer;
  new.approved_at := old.approved_at;
  new.live_email_sent_at := old.live_email_sent_at;
  new.live_email_due_at := old.live_email_due_at;
  if new.created_at is distinct from old.created_at and not (new.created_at > now()) then
    new.created_at := old.created_at;
  end if;
  if new.status in ('rejected','needs_info') and new.status is distinct from old.status then
    new.status := old.status;
  end if;
  if old.approved_at is null then
    if new.status = 'open' or new.status = 'closed' or new.status = 'archived' then
      new.status := case when old.status in ('draft','pending_review','rejected','needs_info') then old.status else 'pending_review' end;
    end if;
    new.published := false;
  end if;
  return new;
end;
$function$;

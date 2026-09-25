-- Applied 2026-09-25 as migration "campaign_reset_set_based".
-- "Refresh — re-queue everyone" silently did nothing: the reset PATCH fired the
-- per-row cs_campaign_requeue_premium guard ~10.5k times (two full scans each),
-- hit the 8s statement timeout, and rolled back. cs_campaign_reset does the same
-- premium check once, set-based, and snapshots rows into a backup table first.

create table if not exists public.email_campaign_reset_backup (
  backed_up_at timestamptz not null default now(),
  campaign_id uuid not null,
  recipient_id uuid not null,
  email text,
  status text,
  provider_message_id text,
  sent_at timestamptz,
  error_message text
);
alter table public.email_campaign_reset_backup enable row level security;
revoke all on public.email_campaign_reset_backup from anon, authenticated;

create or replace function public.cs_campaign_requeue_premium_guard()
 returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
begin
  if current_setting('cs.bulk_requeue', true) = 'on' then return new; end if;
  if new.status = 'queued' and old.status is distinct from 'queued' then
    if exists (
      select 1 from public.profiles p
       where p.membership_status = 'active' and p.email is not null
         and public.cs_email_key(p.email) = public.cs_email_key(new.email)
      union all
      select 1 from auth.users u
        join public.profiles p on p.id = u.id
       where p.membership_status = 'active' and u.email is not null
         and public.cs_email_key(u.email) = public.cs_email_key(new.email)
    ) then
      new.status := 'skipped_is_premium';
    end if;
  end if;
  return new;
end $function$;

create or replace function public.cs_campaign_reset(p_campaign uuid)
 returns integer language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_queued integer;
begin
  insert into public.email_campaign_reset_backup (campaign_id, recipient_id, email, status, provider_message_id, sent_at, error_message)
  select campaign_id, id, email, status, provider_message_id, sent_at, error_message
    from public.email_campaign_recipients
   where campaign_id = p_campaign
     and status not in ('queued','skipped_unsub','skipped_is_user','skipped_invalid');

  perform set_config('cs.bulk_requeue', 'on', true);
  with prem as (
    select public.cs_email_key(p.email) k from public.profiles p
     where p.membership_status = 'active' and p.email is not null
    union
    select public.cs_email_key(u.email) from auth.users u join public.profiles p on p.id = u.id
     where p.membership_status = 'active' and u.email is not null
  )
  update public.email_campaign_recipients r
     set status = case when public.cs_email_key(r.email) in (select k from prem where k is not null)
                       then 'skipped_is_premium' else 'queued' end,
         provider_message_id = null, error_message = null, sent_at = null
   where r.campaign_id = p_campaign
     and r.status not in ('queued','skipped_unsub','skipped_is_user','skipped_invalid');
  perform set_config('cs.bulk_requeue', 'off', true);

  select count(*) into v_queued from public.email_campaign_recipients where campaign_id = p_campaign and status = 'queued';
  update public.email_campaigns set status = 'draft', sent_count = 0, failed_count = 0, updated_at = now() where id = p_campaign;
  return v_queued;
end $function$;

revoke execute on function public.cs_campaign_reset(uuid) from public, anon, authenticated;
grant execute on function public.cs_campaign_reset(uuid) to service_role;

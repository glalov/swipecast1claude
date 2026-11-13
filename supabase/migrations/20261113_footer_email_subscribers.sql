-- Footer "New casting calls, by email" signups (owner 2026-11-13). Double opt-in: a row is only
-- mailed by campaigns once status='confirmed'. Service-role only (the newsletter-subscribe edge fn).
create table if not exists public.email_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_key text not null unique,
  status text not null default 'pending' check (status in ('pending','confirmed','unsubscribed')),
  token text not null unique,
  source text not null default 'footer',
  ip_hash text,
  created_at timestamptz not null default now(),
  confirm_sent_at timestamptz,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);
create index if not exists email_subscribers_ip_recent on public.email_subscribers (ip_hash, created_at desc);
alter table public.email_subscribers enable row level security;
revoke all on public.email_subscribers from public, anon, authenticated;
grant select, insert, update, delete on public.email_subscribers to service_role;

-- Put confirmed subscribers at the FRONT of a campaign's queue (send_batch sends queued rows
-- oldest created_at first). p_email = one address (on confirm); null = every confirmed subscriber.
create or replace function public.cs_add_subscribers_to_campaign(p_campaign uuid, p_email text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare front timestamptz; n integer;
begin
  select coalesce(min(created_at), now()) - interval '1 minute' into front
    from public.email_campaign_recipients where campaign_id = p_campaign and status = 'queued';
  with subs as (
    select s.email, s.confirmed_at from public.email_subscribers s
     where s.status = 'confirmed'
       and (p_email is null or s.email_key = public.cs_email_key(p_email))
       and not exists (select 1 from public.email_unsubscribes u where lower(u.email) = lower(s.email))
  ), ins as (
    insert into public.email_campaign_recipients (campaign_id, email, status, created_at)
    select p_campaign, s.email, 'queued', front - (row_number() over (order by s.confirmed_at desc)) * interval '1 second'
      from subs s
    on conflict (campaign_id, email) do update
       set status = 'queued', created_at = excluded.created_at
     where public.email_campaign_recipients.status in ('skipped_unsub')
    returning 1
  ) select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.cs_add_subscribers_to_campaign(uuid, text) from public, anon, authenticated;
grant execute on function public.cs_add_subscribers_to_campaign(uuid, text) to service_role;

-- New campaign launched (import_recipients flips draft -> sending): confirmed subscribers go first.
create or replace function public.cs_campaign_add_subscribers_on_launch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'sending' and old.status is distinct from 'sending' then
    begin
      perform public.cs_add_subscribers_to_campaign(new.id, null);
    exception when others then
      raise warning 'cs_add_subscribers_to_campaign failed: %', sqlerrm; -- never block a launch
    end;
  end if;
  return new;
end $$;
revoke all on function public.cs_campaign_add_subscribers_on_launch() from public, anon, authenticated;
drop trigger if exists cs_campaign_add_subscribers on public.email_campaigns;
create trigger cs_campaign_add_subscribers after update of status on public.email_campaigns
  for each row execute function public.cs_campaign_add_subscribers_on_launch();

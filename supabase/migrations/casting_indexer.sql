-- Casting indexer (2026-10-01): every 2 hours, announce newly live castings to
-- search engines (IndexNow; Google Indexing API for real-CD JobPosting pages).
-- Edge fn: supabase/functions/casting-indexer. Never contacts people.

create table if not exists public.seo_index_pings (
  url           text not null,
  kind          text not null check (kind in ('new','closed')),
  casting_id    uuid references public.castings(id) on delete cascade,
  indexnow_at   timestamptz,
  google_status text,
  created_at    timestamptz not null default now(),
  primary key (url, kind)
);
alter table public.seo_index_pings enable row level security;
drop policy if exists sip_admin_select on public.seo_index_pings;
create policy sip_admin_select on public.seo_index_pings for select using (public.is_admin());

create table if not exists public.seo_index_runs (
  id        bigserial primary key,
  ran_at    timestamptz not null default now(),
  announced int, indexnow int, google int, closed int,
  notes     text
);
alter table public.seo_index_runs enable row level security;
drop policy if exists sir_admin_select on public.seo_index_runs;
create policy sir_admin_select on public.seo_index_runs for select using (public.is_admin());

create or replace function public.run_casting_indexer()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_secret text;
begin
  select value into v_secret from public.app_secrets where key = 'seo_agent_secret';
  perform net.http_post(
    url := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/casting-indexer',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12cWhxYmpqdmdrZnRuaW5qY2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTYxNTYsImV4cCI6MjA5MTc3MjE1Nn0.WAienaroHhm02oHSeFx_Sy9xZROno7ATatqDEGu_cbk'),
    body := jsonb_build_object('action','run','secret',v_secret),
    timeout_milliseconds := 120000);
end; $function$;
revoke execute on function public.run_casting_indexer() from public, anon, authenticated;

select cron.schedule('casting-indexer-2h', '17 */2 * * *', 'select public.run_casting_indexer();');

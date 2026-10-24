-- Applied 2026-10-23 via MCP (migration name: privacy_requests).
-- "Your Privacy Choices" requests (state privacy-law opt-out / limit-SPI requests).
-- Written only by the privacy-request edge function (service role). Never readable by
-- the browser: RLS on, no policies, and no grants to anon/authenticated.
create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  state text not null,
  requester_type text not null check (requester_type in ('consumer','agent')),
  first_name text not null,
  last_name text not null,
  email text not null,
  consumer_first_name text,
  consumer_last_name text,
  consumer_email text,
  request_opt_out boolean not null default false,
  request_limit_spi boolean not null default false,
  details text,
  ip_hash text,
  user_agent text,
  email_sent boolean not null default false,
  status text not null default 'new' check (status in ('new','in_progress','completed','denied')),
  handled_at timestamptz,
  notes text,
  constraint privacy_requests_some_request check (request_opt_out or request_limit_spi)
);
create index privacy_requests_created_idx on public.privacy_requests (created_at desc);
create index privacy_requests_ip_idx on public.privacy_requests (ip_hash, created_at desc);
alter table public.privacy_requests enable row level security;
revoke all on public.privacy_requests from anon, authenticated;
grant select, insert, update, delete on public.privacy_requests to service_role;
comment on table public.privacy_requests is 'Your Privacy Choices requests from /privacy-choices; service-role only (edge fn privacy-request).';

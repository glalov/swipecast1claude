-- member_announce_logs — one row per member per announcement actually sent.
--
-- The UNIQUE (announce_key, user_id) is the whole point: member-announce writes
-- a row only AFTER Resend accepts the batch, and skips anyone already present on
-- the next run. That makes the send idempotent — a double-click, a retry after a
-- timeout, or a deliberate re-run to catch new signups can never mail the same
-- person twice for the same announcement.

create table if not exists public.member_announce_logs (
  id            bigint generated always as identity primary key,
  announce_key  text        not null,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  email         text        not null,
  variant       text        not null check (variant in ('premium','free')),
  provider_id   text,
  sent_at       timestamptz not null default now(),
  constraint member_announce_logs_once unique (announce_key, user_id)
);

create index if not exists member_announce_logs_key_idx  on public.member_announce_logs (announce_key);
create index if not exists member_announce_logs_sent_idx on public.member_announce_logs (sent_at desc);

-- Service-role only: the edge function writes these, nothing client-side reads them.
alter table public.member_announce_logs enable row level security;

-- No policies are defined on purpose — with RLS on and no policy, anon and
-- authenticated get nothing, while the service-role key bypasses RLS entirely.

revoke all on public.member_announce_logs from anon, authenticated;

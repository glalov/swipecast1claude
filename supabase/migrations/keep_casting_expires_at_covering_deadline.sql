-- Keep castings.expires_at from falling behind castings.deadline.
--
-- Symptom this fixes: a casting whose deadline was extended kept its old
-- expires_at, so the listing was badged "Expired / Applications closed" AND
-- "33 days left to apply · closes Aug 31, 2026" at the same time, and dropped
-- out of Browse Castings entirely (the list filters on BOTH fields — see the
-- filter in swipecast-full.jsx and castingIsExpired(), which checks expires_at
-- first and only falls back to deadline).
--
-- Why a trigger rather than app code: the app already repairs this, but only in
-- the admin editor (swipecast-full.jsx ~line 21706). Its own comment notes the
-- CD edit modal "doesn't touch expires_at", and neither path runs at all when a
-- row is edited directly in the Supabase table editor. A BEFORE trigger covers
-- every write path.
--
-- Scope is deliberately narrow:
--   * Only raises expires_at when it is EARLIER than the deadline — the case
--     that is always contradictory.
--   * An expires_at set LATER than the deadline is left alone (that is a valid
--     grace window; several live rows use it).
--   * A NULL expires_at keeps its existing "no explicit expiry" meaning.

create or replace function public.sync_casting_expires_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.deadline is not null
     and new.expires_at is not null
     and new.expires_at < (new.deadline::date + interval '1 day' - interval '1 second')
  then
    new.expires_at := (new.deadline::date + interval '1 day' - interval '1 second');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_casting_expires_at on public.castings;

create trigger trg_sync_casting_expires_at
  before insert or update of deadline, expires_at on public.castings
  for each row
  execute function public.sync_casting_expires_at();

-- Non-payment grace period: 3 days -> 30 days ("Adobe model"). Applied live 2026-08-27.
--
-- Stripe (Revenue recovery -> Retries) is configured to retry a failed card
-- 8 times over 2 months and to LEAVE THE SUBSCRIPTION PAST-DUE instead of
-- canceling it, so a member with an empty card stays a member and keeps being
-- charged until they cancel themselves. Cutting their access off on day 4 while
-- we are still collecting for another 8 weeks churns the exact person we are
-- trying to recover, so Premium now survives a full 30 days of non-payment.
-- The whole policy is the one interval below.
--
-- Run by cron job 15 "past-due-downgrade-hourly" (25 * * * *).
CREATE OR REPLACE FUNCTION public.enforce_past_due_downgrades()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer;
begin
  with locked as (
    update public.profiles
       set membership_status  = 'free',
           premium_locked_at  = coalesce(premium_locked_at, now()),
           updated_at         = now()
     where membership_status = 'active'
       and subscription_status in ('past_due', 'unpaid')
       and past_due_since is not null
       and past_due_since <= now() - interval '30 days'
    returning id
  )
  select count(*) into n from locked;

  if n > 0 then
    raise log '[past-due-sweep] downgraded % member(s) to free for non-payment', n;
  end if;
  return n;
end;
$function$;

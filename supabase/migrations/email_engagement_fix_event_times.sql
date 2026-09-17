-- resend-webhook v11 stamped opens/clicks with data.created_at (the email's send
-- time) instead of the event's own time (the envelope's created_at). Every open
-- of 2026-09-16 therefore read as 13:00/22:00 sharp. created_at on the event row
-- is when the webhook arrived -- the closest record of when the open happened.
update public.email_engagement_events
   set occurred_at = created_at
 where event_type in ('opened','clicked','delivered')
   and created_at - occurred_at > interval '10 seconds';

update public.email_engagement ee
   set last_open_at  = x.last_open,
       last_click_at = x.last_click,
       updated_at    = now()
  from (
    select user_id,
           max(occurred_at) filter (where event_type='opened')  as last_open,
           max(occurred_at) filter (where event_type='clicked') as last_click
      from public.email_engagement_events
     where user_id is not null
     group by user_id
  ) x
 where x.user_id = ee.user_id;

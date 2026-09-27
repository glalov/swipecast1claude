-- 1. Five SECURITY DEFINER functions were callable by anyone (anon included) with no
--    caller check. resume_paused_email_campaigns re-enabled the daily digest + upsell.
--    Only cron (postgres) and a definer trigger use them, neither needs these grants.
revoke execute on function public.cs_campaign_suppress_premium(text) from public, anon, authenticated;
revoke execute on function public.dispatch_casting_digest() from public, anon, authenticated;
revoke execute on function public.mark_notification_emailed(uuid) from public, anon, authenticated;
revoke execute on function public.resume_paused_email_campaigns() from public, anon, authenticated;
revoke execute on function public.run_weekly_upsell_if_due() from public, anon, authenticated;

-- 2. Dormant QA admin (created 2026-06-11, last login 2026-06-12) → normal talent account.
create table if not exists public.qa_admin_demote_backup_20260927 as
  select id, email, user_type, now() as backed_up_at from public.profiles where email = 'qa-admin-test@castslate.com';
alter table public.qa_admin_demote_backup_20260927 enable row level security;
revoke all on public.qa_admin_demote_backup_20260927 from anon, authenticated;
update public.profiles set user_type = 'talent' where email = 'qa-admin-test@castslate.com' and user_type = 'admin';

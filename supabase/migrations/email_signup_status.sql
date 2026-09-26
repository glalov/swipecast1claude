-- How an address is already registered, so the signup forms can show the right
-- message: 'none' | 'oauth' (Google etc., no password identity) | 'confirmed'
-- (email+password, confirmed) | 'unconfirmed' (email+password, never confirmed).
-- Same exposure as check_email_exists, which the forms already call anonymously.
create or replace function public.email_signup_status(p_email text)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public', 'auth'
as $function$
  select coalesce((
    select case
      when not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') then 'oauth'
      when u.email_confirmed_at is not null then 'confirmed'
      else 'unconfirmed'
    end
    from auth.users u
    where lower(trim(u.email)) = lower(trim(p_email))
    limit 1
  ), 'none');
$function$;
revoke all on function public.email_signup_status(text) from public;
grant execute on function public.email_signup_status(text) to anon, authenticated;

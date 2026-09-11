-- Applied via Supabase MCP 2026-09-10 (migration ban_cancels_stripe_and_terms_version_2026_09_10).
-- Terms Addendum Y §5(c): a terminated (banned / admin-deleted) account is not charged again.
-- Ban / admin delete → pg_net → edge fn stripe-ban-cancel (cancels with no proration/refund).
insert into public.app_secrets(key, value, updated_at)
values ('ban_cancel_secret', encode(extensions.gen_random_bytes(24), 'hex'), now())
on conflict (key) do nothing;

create or replace function public._cancel_stripe_for_termination(p_user_id uuid, p_sub text, p_cust text, p_action text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_sub is null and p_cust is null then return; end if;
  perform net.http_post(
    url     := 'https://mvqhqbjjvgkftninjcby.supabase.co/functions/v1/stripe-ban-cancel',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object(
      'secret', (select value from public.app_secrets where key = 'ban_cancel_secret'),
      'user_id', p_user_id, 'subscription_id', p_sub, 'customer_id', p_cust, 'action', p_action),
    timeout_milliseconds := 20000);
end $$;
revoke execute on function public._cancel_stripe_for_termination(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.admin_set_user_banned(p_user_id uuid, p_banned boolean, p_reason text default null::text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_was boolean; v_target text; v_sub text; v_cust text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select banned, user_type, stripe_subscription_id, stripe_customer_id
    into v_was, v_target, v_sub, v_cust from public.profiles where id = p_user_id;
  if v_target is null then raise exception 'user not found'; end if;
  if v_target = 'super_admin' and not public.is_super_admin() then raise exception 'only super_admin can ban a super_admin' using errcode='42501'; end if;
  update public.profiles
    set banned = p_banned,
        banned_reason = case when p_banned then p_reason else null end,
        banned_at     = case when p_banned then now()     else null end,
        suspended     = case when p_banned then true else suspended end
    where id = p_user_id;
  perform public._audit(
    case when p_banned then 'user.ban' else 'user.unban' end,
    'profiles', p_user_id,
    jsonb_build_object('banned',v_was),
    jsonb_build_object('banned',p_banned), p_reason);
  -- Addendum Y §5(c): a ban ends billing (no proration/refund — §5(a)).
  if p_banned and not coalesce(v_was, false) then
    perform public._cancel_stripe_for_termination(p_user_id, v_sub, v_cust, 'ban');
  end if;
end $function$;

create or replace function public.admin_delete_profile(p_user_id uuid, p_reason text default null::text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_row record;
begin
  if not public.is_super_admin() then raise exception 'only super_admin can delete profiles' using errcode='42501'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot delete your own profile'; end if;
  select * into v_row from public.profiles where id = p_user_id;
  if not found then return; end if;
  if v_row.user_type = 'super_admin' then raise exception 'cannot delete another super_admin via this RPC'; end if;
  delete from public.profiles where id = p_user_id;
  perform public._audit('profile.delete','profiles',p_user_id,to_jsonb(v_row),null,p_reason);
  -- Addendum Y §5(c): an admin-deleted account is not charged again.
  perform public._cancel_stripe_for_termination(p_user_id, v_row.stripe_subscription_id, v_row.stripe_customer_id, 'admin_delete');
end $function$;

-- Material Terms change (Addendum Y): new acceptances record the new version.
alter table public.profiles alter column terms_version set default '2026-09-10';

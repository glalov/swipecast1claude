-- Shortlist email: show the photo the actor actually submitted for that role.
-- Applied 2026-09-22.
--
-- Premium members upload many photos and choose a different one per
-- submission, so the email must use applications.selected_photo_url for THAT
-- application. The edge function needs the application id to look it up, and
-- decide_application was not sending it. Everything else in the function stays
-- exactly as it was, so this patches the live definition in place (read it,
-- string-replace the one jsonb_build_object, re-execute) instead of retyping a
-- ~4 KB function and risking drift. The hold branch is deliberately untouched:
-- the "still deciding" email carries no photo.
--
-- Re-running this is a no-op guarded by the anchor check: once patched, the
-- needle no longer matches and it raises rather than silently doing nothing.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'decide_application';

  if src is null then
    raise exception 'decide_application not found';
  end if;

  if src like '%''application_id'', p_application%' then
    raise notice 'decide_application already passes application_id - nothing to do';
    return;
  end if;

  patched := replace(
    src,
    $needle$          'cd_name',      v_cd_name
        )
      );
      if v_notif_id$needle$,
    $repl$          'cd_name',      v_cd_name,
          'application_id', p_application
        )
      );
      if v_notif_id$repl$
  );

  if patched = src then
    raise exception 'anchor not found - decide_application was not patched';
  end if;

  execute patched;
end $$;

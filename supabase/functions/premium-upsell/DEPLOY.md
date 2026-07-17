# Premium Upsell — Deploy Checklist

Twice-daily "castings + go Premium" campaign to **non-premium talent only**.
Everything below is code-complete in the repo. These steps make it **live**.
Do them **in order** — backend first, frontend last.

> ⚠️ Not live until every step is done. The admin panel section will error until
> steps 1–2 (SQL + function) are deployed.

## 1. Run the SQL migration
Supabase Dashboard → SQL Editor → paste + run the whole file:
`supabase/migrations/premium_upsell.sql`

Creates: `premium_upsell_logs` table, `site_settings.premium_upsell_enabled`
(default **true**) + `premium_upsell_paused`, `email_preferences.premium_upsell_optout`,
the `run_premium_upsell()` helper, and the two cron jobs.

## 2. Create the Vault secret (used by cron auth)
SQL Editor:
```sql
select vault.create_secret('<YOUR-SERVICE-ROLE-KEY>', 'premium_upsell_service_role_key');
```
(Service-role key: Dashboard → Project Settings → API → `service_role`.)

## 3. Deploy the edge function
```
supabase functions deploy premium-upsell --project-ref mvqhqbjjvgkftninjcby --no-verify-jwt
```
⚠️ **`--no-verify-jwt` is REQUIRED.** This function has a public GET
`?action=unsubscribe` endpoint clicked straight from an email (no auth header).
Without the flag, Supabase's gateway rejects every unsubscribe click with
`401 UNAUTHORIZED_NO_AUTH_HEADER` before the function runs. The POST `run`/`test`
paths are safe because they enforce their own service-role/admin-secret/admin-JWT
check in-code. (Same pattern as news-refresh / weekly-checkin-run / weekly-upsell.)

(Or Dashboard → Edge Functions → `premium-upsell` → Details → turn **Verify JWT** off.)
Reuses existing secrets already set for the digest: `RESEND_API_KEY`,
`NOTIFY_FROM_EMAIL`, `APP_URL`, `CONTACT_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Smoke test (before it goes live to anyone)
Admin → **Premium Upsell** → enter your email → **Send Test** (try both noon &
evening). Confirm it lands and looks right.

## 5. Ship the frontend
```
./deploy.sh "Add Premium Upsell admin section + campaign"
```
Pushes `index.html` + `app.js` + `swipecast-full.jsx` → Vercel.

## 6. Verify live
- Admin → Premium Upsell shows **● ACTIVE**, toggle saves.
- Optionally click **Run Noon Now** once and watch the noon "Received" card + logs.
- Cron: `select jobname, schedule, active from cron.job where jobname like 'premium-upsell-%';`

## Notes
- **Times**: 16:00 UTC (noon NY / EDT) + 22:00 UTC (6pm NY / EDT). Shift +1h in
  winter (EST) if you want to hold noon/6pm exactly.
- **Off switch**: Admin toggle (instant, no redeploy) or `premium_upsell_paused`.
- **Premium safety**: recipients are `membership_status != 'active'` resolved at
  send time + an in-loop backstop, so upgraders drop out automatically and
  premium members are never emailed.
- **Unsubscribe** here sets `premium_upsell_optout` only — their casting digest
  is untouched. Hard-bounced/complained addresses stay globally suppressed.

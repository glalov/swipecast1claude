# Project Status

## 2026-05-10 — Account Settings page for all logged-in users

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Added `AccountSettingsPage` component (~430 lines) with 6 sidebar sections. Added `account-settings` to `PAGE_PATH`. Added route in main router. Changed nav profile-name button to navigate to Account Settings (desktop: `Name ⚙`). Added "My Profile" + "Account Settings" entries to mobile menu. |
| `supabase-schema.sql` | Migration `account_settings_fields`: adds 8 new columns to `profiles`. |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Schema changes (migration `account_settings_fields`)

```sql
alter table public.profiles
  add column if not exists account_status          text        not null default 'active',
  add column if not exists deactivated_at          timestamptz,
  add column if not exists deletion_requested_at   timestamptz,
  add column if not exists deleted_at              timestamptz,
  add column if not exists notification_email      boolean     not null default true,
  add column if not exists notification_applications boolean   not null default true,
  add column if not exists notification_messages   boolean     not null default true,
  add column if not exists notification_marketing  boolean     not null default false;
```

Applied to Supabase production. `NOTIFY pgrst, 'reload schema'` executed.

### Settings pages added

| Section | Status |
|---|---|
| **Account Settings** (overview) | Functional — shows name, email, role, account status, quick-action links |
| **Subscription Info** | Functional — shows current plan (Free/Premium for actors, verification status for CDs, Admin badge for admins). Stripe Customer Portal placeholder with TODO. |
| **Payment & Billing** | Placeholder — clear "not connected yet" message. TODO block for Stripe Customer Portal integration. |
| **Notifications** | Functional — 4 toggles (email, application updates, messages, marketing). Saves to `profiles` via RLS. |
| **Privacy & Security** | Functional — shows email, role, verification status (for CDs), member since date. "Send Reset Email" triggers Supabase `resetPasswordForEmail`. "Sign Out All Sessions" placeholder (requires Supabase admin API). |
| **Deactivation & Deletion** | Functional — see below |

### Deactivation & Deletion behavior

**Deactivate Account:**
- Confirmation modal listing exact consequences (profile hidden, notifications paused, castings blocked for CDs)
- `super_admin` shown extra browser-confirm before deactivating
- Sets `account_status = 'deactivated'`, `deactivated_at = now()` in profiles
- Shows "Reactivate" button when already deactivated
- Reactivation sets `account_status = 'active'`, clears `deactivated_at`

**Delete Account:**
- Requires user to type `DELETE` into a text field before the button enables
- Soft delete: sets `account_status = 'deletion_requested'`, `deletion_requested_at = now()`
- Shows: "Account deletion request submitted. Support will review and complete deletion within 30 days."
- Full auth deletion requires a server-side Supabase Admin API call (see "What still needs server work")

### Safety rules enforced

1. Users can only update their own `profiles` row (Supabase RLS: `id = auth.uid()`)
2. Normal users cannot access Admin page through settings (admin route guards unchanged)
3. Actors/CDs see no admin controls in Account Settings
4. `super_admin` gets an extra confirmation dialog before deactivating
5. Account Settings accessible only to authenticated users (renders `<div style={{minHeight:"60vh"}}/>` if not logged in)

### Navigation / access

- **Desktop nav**: User name button → Account Settings (shows `FirstName ⚙`)
- **Mobile menu**: "My Profile" + "Account Settings" both listed under auth section
- **URL**: `/account-settings` (routed via Vercel catch-all rewrite)
- **AccountSettingsPage sidebar**: includes "← My Profile" link back to profile page

### What still needs Stripe / Supabase server work later

| Feature | What's needed |
|---|---|
| Payment & Billing portal | Supabase Edge Function → Stripe `billingPortal.sessions.create` → return URL |
| Full account deletion | `supabaseAdmin.auth.admin.deleteUser(uid)` in a server-side function. Deletion request is stored; support must run this manually until automated. |
| Email delivery honoring notification prefs | Wire `notification_*` columns to your email provider (Resend/SendGrid) — columns are stored, just not checked server-side yet |
| Sign out all sessions | `supabaseAdmin.auth.admin.signOut(uid, "global")` in an Edge Function |

---

## 2026-05-10 — Fix broken auth state, nav buttons, and stuck castings loading

### Root cause

Three independent issues all manifested together after the `add_verification_columns_to_profiles` migration:

1. **`loadProfile` had no timeout.** When the Supabase PostgREST process reloads its schema cache (triggered by `NOTIFY pgrst, 'reload schema'`), it briefly stops responding to queries. Any `loadProfile` call during that window would `await` forever. Because `onAuthStateChange` `await`s `loadProfile` before calling `setAuthReady(true)`, the nav rendered `null` (its `!authReady` guard) — **all top-right buttons vanished**.

2. **`onAuthStateChange` had no overall try/finally.** An unexpected exception anywhere in the handler body could prevent `setAuthReady(true)` from firing.

3. **`FeaturedCastingsSlider.fetchCastings` and `SearchPage.fetchTalent` had no timeout.** If the DB or PostgREST was slow, the `finally{setLoading(false)}` / `Promise.all().finally()` never ran, leaving the "Loading active casting calls…" spinner permanently visible.

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | `loadProfile`: added 10 s `Promise.race` timeout so it always resolves even if PostgREST is reloading. `onAuthStateChange`: wrapped body in `try/catch/finally` with `setAuthReady(true)` in the `finally` block — guaranteed to fire no matter what. `FeaturedCastingsSlider.fetchCastings`: added 10 s timeout matching `SearchPage.fetchCastings`. `fetchTalent`: added 10 s timeout so `Promise.all().finally()` always fires and the search loading spinner always stops. |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Supabase

Sent `NOTIFY pgrst, 'reload schema'` again to ensure PostgREST has the latest schema after adding the verification columns.

### Role/access behaviour (unchanged, confirmed correct)

- `super_admin` / `admin` → Admin button + Dashboard + Inbox + Profile
- `cd` → Dashboard + Inbox + Profile (no Admin button)
- `talent` → Inbox + Profile (no Admin, no Dashboard)
- Non-admin visiting `/admin` directly → blank 60 vh placeholder (footer does not jump)

---

## 2026-05-10 — Fix admin 404, missing verification columns, footer jump

### Root cause + fixes

| Problem | Root cause | Fix |
|---|---|---|
| `/admin` gives Vercel 404 | `vercel.json` rewrite used negative-lookahead regex `/((?!.*\\.).*)`  which `path-to-regexp` silently rejected | Changed to simple `/(.*)`  catch-all — actual files still win over rewrites |
| "column profiles.verification_status does not exist" | 10 verification columns were referenced in frontend queries but never added to the live DB | Applied migration `add_verification_columns_to_profiles` |
| Footer jumping on admin page | Admin route rendered `null` for non-admin/unauthenticated users | Changed to `<div style={{minHeight:"60vh"}}/>` |

---

## 2026-05-10 — Casting creator identity verification gate

### What changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Added `CastingVerifiedBadge` (Background Checked badge with disclaimer tooltip), `CastingCreatorVerificationBanner` (shown in CD Dashboard to unverified accounts), and expanded `NewCastingModal` to block unverified accounts. Updated `FeaturedCastingsSlider` query to include new verification fields and replaced simple `verified` badge logic with ID Verified + Background Checked badges. `CastingDetailPage` now fetches CD profile data and shows verification badges near the producer line. Added `AdminCDVerification` section to the admin panel (Approve / Reject / Needs Review / Reset per creator). Updated `AdminUsers` to fetch and display verification status in `UserRow`. Updated `AdminOverview` to show "CDs approved to post" and "CD verif. pending" stat tiles. |
| `supabase-schema.sql` | New migration `2026-05-10 — casting_creator_verification`: adds 10 new columns to `profiles` (verification_status, identity_verified, background_check_status, can_post_castings, verification_provider, verification_session_id, plus 4 timestamp columns). Adds `can_post_castings_check()` helper. Tightens `castings_insert` RLS policy to require `can_post_castings = true` (admins bypass). Adds 5 new RPCs: `start_verification_session`, `admin_approve_casting_creator`, `admin_reject_casting_creator`, `admin_needs_review_casting_creator`, `admin_reset_casting_verification`. |
| `index.html` | Rebuilt from `swipecast-full.jsx` via `python3 build-html.py`. |

### How it works

**User flow (unverified CD):**
1. CD creates account → `verification_status = not_started`, `can_post_castings = false`
2. CD clicks "+ New Casting" → blocked at modal level with lock screen
3. CD dashboard shows amber verification banner with "Start Verification" button
4. Clicking "Start Verification" calls `start_verification_session()` RPC → sets status to `pending` but does NOT grant verification
5. A real provider (Persona/Didit/Stripe Identity) must be connected for live verification

**Admin flow:**
1. Admin panel → "CD Verification" section lists all CD accounts with status
2. Admin can Approve / Reject / Needs Review / Reset each creator
3. Approve sets: `verification_status=verified`, `identity_verified=true`, `background_check_status=passed`, `can_post_castings=true`
4. All actions are audit-logged via `_audit()`

**Gate layers:**
- UI: `NewCastingModal` blocks if `can_post_castings !== true`
- UI: dashboard banner always visible when not verified
- DB: `castings_insert` RLS policy enforces `can_post_castings_check()` — cannot be bypassed by direct insert
- Server: `start_verification_session` RPC refuses to self-approve

### Database migration required

Run in Supabase SQL Editor — paste the `MIGRATION 2026-05-10 — casting_creator_verification` block from `supabase-schema.sql`, then:
```sql
NOTIFY pgrst, 'reload schema';
```

This is safe to re-run (uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

### Third-party verification providers — what you need

The gate is built and working. To connect a real provider, you need one of:

**Persona** (recommended — most flexible, good free tier)
- Account: persona.com
- API key: `PERSONA_API_KEY`
- Inquiry template ID: create an "ID + Selfie" template → get `tmpl_...`
- Webhook secret: `PERSONA_WEBHOOK_SECRET`
- Redirect URL: `https://slatecue.com/verify-return` (or your domain)
- Webhook endpoint: Supabase Edge Function at `/functions/v1/persona-webhook`
- Edge function should: verify signature → on `inquiry.completed` → call `admin_approve_casting_creator` or `admin_needs_review_casting_creator`

**Didit**
- Account: didit.me
- API key: `DIDIT_API_KEY`
- Verification workflow ID
- Webhook secret: `DIDIT_WEBHOOK_SECRET`
- Redirect URL + webhook endpoint (same pattern as Persona)

**Stripe Identity**
- Stripe account (existing one works)
- `STRIPE_SECRET_KEY` (already needed for payments)
- Webhook secret: `STRIPE_IDENTITY_WEBHOOK_SECRET`
- Create a VerificationSession server-side → return URL to browser
- On `identity.verification_session.verified` webhook → approve creator

**Easiest to connect:** Stripe Identity — you likely already have/need a Stripe account for actor Premium payments. One account, one webhook endpoint, two features.

### What third-party setup is still needed

- [ ] Choose a verification provider (Persona / Didit / Stripe Identity)
- [ ] Create account + API keys
- [ ] Build Supabase Edge Function for webhook receiver
- [ ] Wire `start_verification_session` to redirect to provider's hosted flow
- [ ] On webhook callback: call `admin_approve_casting_creator` or `admin_needs_review_casting_creator`
- [ ] Until then: Admin must manually approve creators via Admin → CD Verification

---

## 2026-05-09 — Stripe placeholder: Premium checkout disabled until Stripe is wired

### What changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | `PlanSummaryPage`: removed `activate_membership` RPC call from the browser. Button now reads "Upgrade to Premium — $9.99/month". Clicking shows "Premium checkout is not connected yet. Please try again later." `done`/`busy` states removed (no longer needed). Added comprehensive TODO block near Stripe constants listing every step required to complete Stripe integration. |
| `index.html` | Rebuilt from `swipecast-full.jsx` via `python3 build-html.py`. Deployed to Vercel production (commit `2471e87`). |

### Stripe integration — what is NOT connected yet

Premium accounts already in the DB stay Premium (their `membership_status='active'` row is unchanged). New upgrades are fully blocked at the UI until Stripe is configured.

#### Steps to enable real Premium payments

1. **Create a Stripe account** at https://dashboard.stripe.com
2. **Create Product** "SlateCue Actor Premium" → recurring price $9.99/month
3. **Copy the Price ID** (e.g. `price_1ABC...`) → paste into `STRIPE_ACTOR_PREMIUM_PRICE_ID` in `swipecast-full.jsx`
4. **Create a server-side checkout endpoint** (Supabase Edge Function or Next.js API route at `POST /api/stripe/checkout`):
   - Accept the user's `auth.uid()` as `client_reference_id`
   - Create a Stripe Checkout Session with the price ID
   - Return the session URL to the browser (browser redirects to it)
5. **Handle `checkout.session.completed` webhook** server-side:
   - Verify the Stripe signature with `STRIPE_WEBHOOK_SECRET`
   - Call `window.sb.rpc("activate_membership", {p_plan:"monthly"})` — or direct UPDATE — for the `client_reference_id` user
   - **NEVER call `activate_membership` from the browser**
6. **Set env vars** in Vercel: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
7. **Replace `STRIPE_ACTOR_LINK`** in `swipecast-full.jsx` with your live Stripe Payment Link or point `handleUpgradeClick` to your `/api/stripe/checkout` endpoint
8. **Remove the "not connected yet" placeholder message** and redirect the user to Stripe Checkout instead

### What the button currently does

- Button label: "Upgrade to Premium — $9.99/month"
- On click: shows red notice "Premium checkout is not connected yet. Please try again later."
- No RPC is called. No DB state changes. Existing Premium accounts unaffected.

---

## 2026-05-09 — Actor Free vs Premium plan limits

### What changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Added `FREE_PLAN`, `PREMIUM_PLAN`, `PREMIUM_PRICE`, `UPGRADE_MSG` constants. Updated `ActivateMembershipBanner` to display free-plan limits. Updated `MembershipPage` copy. Rewrote `PricingPage` with Free vs Premium actor comparison table. Updated `CastingDetailPage`: free actors now allowed to submit (up to 3/day); daily count is loaded from DB on mount; upgrade modal fires when limit is reached; submissions counter badge shown. Updated `MyProfilePage`: headshot/video upload gated by plan — free actors limited to 1 headshot and 0 additional photos/videos; premium actors get 10 headshots and 5 video links. |
| `supabase-schema.sql` | Added `submit_application(uuid,uuid,text,text)` SECURITY DEFINER RPC that enforces per-plan daily submission limits (3 for free, unlimited for active/premium) and prevents duplicate role applications. |

### Plan limits (single source of truth in code)

| Limit | Free | Premium ($9.99/month) |
|---|---|---|
| Casting submissions / day | 3 | Unlimited |
| Headshots total | 1 | 10 |
| Video reel links | 0 | 5 |
| Price | Free | $9.99/month |

### Enforcement layers

1. **Client-side pre-check** — `CastingDetailPage` counts today's applications before opening the apply modal. Free actors who've hit 3 see an upgrade prompt, not the apply form.
2. **Server-side RPC** — `submit_application` enforces the same limits inside a SECURITY DEFINER function that cannot be bypassed via direct insert.
3. **Profile upload UI** — `MyProfilePage` blocks additional photo/video uploads for free actors at the UI layer.

### ⚠️ Stripe / payment — what still needs to be done

The Premium plan upgrade flow (`MembershipPage` → `PlanSummaryPage`) calls `activate_membership` RPC which **does not charge a card yet**. Before launch:

1. **Create a Stripe Product** for "SlateCue Actor Premium" at $9.99/month.
2. **Get the Stripe Price ID** (looks like `price_1ABC...`).
3. **Create a Stripe Checkout session** server-side (Supabase Edge Function or Next.js API route) that:
   - Accepts the user's `auth.uid()` as `client_reference_id`
   - Uses the price ID above
   - On `checkout.session.completed` webhook → call `activate_membership` RPC or directly `UPDATE profiles SET membership_status='active', plan_type='monthly'` for the user.
4. **Replace** `STRIPE_ACTOR_LINK` in `swipecast-full.jsx` (line ~1079) with the live Stripe Checkout URL or redirect to your Edge Function endpoint.
5. **Replace** the placeholder test link (`https://buy.stripe.com/test_bJe28l3C5bgq2XQcuL7g401`) with your live Stripe Payment Link.

Until Stripe is wired up, clicking "Upgrade" takes users through the plan selection UI and calls `activate_membership` RPC directly — which sets `membership_status='active'` in the DB **without collecting payment**. This is intentional placeholder behavior.

### DB migration required

Run the following in Supabase SQL editor to deploy the new `submit_application` function:

```sql
-- Copy/paste the submit_application function block from the bottom of supabase-schema.sql
-- Then reload PostgREST:
NOTIFY pgrst, 'reload schema';
```

---

## 2026-05-09 — Fix Admin Users page: all action buttons broken

### Root cause
Every admin RPC call from the frontend used `p_target` as the user-ID parameter, but the actual Supabase database functions expect `p_user_id`. PostgREST matches functions by parameter names, so every call failed with "Could not find the function … in the schema cache."

Additionally, the ban RPC used `p_target_banned` but the database expects `p_banned`.

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` (AdminUsers, UserRow) | Fixed all 6 RPC parameter names: `p_target` → `p_user_id`, `p_target_banned` → `p_banned`. Added loading/busy state per user row (buttons disabled while action runs). Added success/error message styling (green/red). Added confirmation before unban. Prevented removing own super_admin role. Prevented deleting super_admin accounts from UI. |
| `supabase-schema.sql` | Updated all admin RPC definitions to match actual database signatures (`p_user_id`, `p_banned`, `p_note`, `uuid` types for `_audit`). Schema file now accurately reflects deployed DB functions. |
| `PROJECT_STATUS.md` | Created this file. |

### RPC parameter mapping (before → after)

| Function | Old (broken) params | New (correct) params |
|---|---|---|
| `admin_set_user_role` | `p_target, p_role` | `p_user_id, p_role` |
| `admin_set_user_verified` | `p_target, p_verified` | `p_user_id, p_verified` |
| `admin_set_user_featured` | `p_target, p_featured` | `p_user_id, p_featured` |
| `admin_set_user_suspended` | `p_target, p_suspended, p_reason` | `p_user_id, p_suspended, p_reason` |
| `admin_set_user_banned` | `p_target, p_target_banned, p_reason` | `p_user_id, p_banned, p_reason` |
| `admin_delete_profile` | `p_target` | `p_user_id` |

### Buttons fixed
1. **Role dropdown** — saves to DB, prevents self-demotion from super_admin
2. **Verify** — toggles `verified` boolean via corrected RPC
3. **Feature** — toggles `featured` boolean via corrected RPC
4. **Suspend** — toggles with reason modal, corrected RPC params
5. **Ban** — toggles with reason modal + confirmation, corrected RPC params
6. **Delete** — confirmation dialog, blocks self-delete and super_admin delete

### Notes
- No database migration needed — the functions already existed with the correct signatures in Supabase; only the frontend calls were wrong.
- The verification fields mentioned in the spec (`identityVerified`, `backgroundCheckStatus`, `canPostCastings`, `verificationStatus`, `verificationApprovedAt`) do not exist in the current schema. The platform uses a single `verified` boolean column. Adding those fields would require a broader schema + app change.

---

## 2026-05-09 — Fix Admin → Castings page: all action buttons broken

### Root cause
The live Supabase database functions use `p_casting_id` as the casting UUID parameter, but the frontend was calling them with `p_casting`. PostgREST matches functions by exact parameter names, so every RPC call failed with:
> `Could not find the function public.admin_set_casting_status(p_casting, p_status) in the schema cache`

Additionally, `admin_set_casting_status` in the live DB has a third optional parameter `p_note text DEFAULT NULL` that was absent from the local schema file.

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` (AdminCastings) | Fixed RPC param `p_casting` → `p_casting_id` in `toggleFeatured` and `setStatus`. Added `busy` state (per casting + action key) so buttons show "…" and are disabled while the request is in flight. Added `showMsg` helper that auto-clears the message after 4 s. Added `console.log` before each RPC/delete call logging the function name and params sent. |
| `supabase-schema.sql` | Updated `admin_set_casting_featured` and `admin_set_casting_status` definitions to use `p_casting_id` to match the live DB. Added `p_note text default null` third param to `admin_set_casting_status`. Updated the `grant execute` line for the status function to include the third `text` arg. |

### RPC parameter fix

| Function | Old (broken) | New (correct) |
|---|---|---|
| `admin_set_casting_featured` | `p_casting` | `p_casting_id` |
| `admin_set_casting_status` | `p_casting` | `p_casting_id` |

### Buttons — what they now do
1. **View** — opens a detail modal showing all casting fields, roles, and creator info
2. **Edit** — opens `EditCastingModal` pre-filled with casting data; saves to DB on submit
3. **Feature / Unfeature** — calls `admin_set_casting_featured`; label and ★ badge reflect current state; button disabled while in flight
4. **Close / Reopen** — calls `admin_set_casting_status` with `"closed"` or `"open"`; button disabled while in flight; closed castings rendered at 55% opacity
5. **Delete** — shows `confirm()` dialog before calling direct `.delete()` (admin RLS policy permits it); button disabled while in flight

### Manual Supabase steps
- `NOTIFY pgrst, 'reload schema';` was already executed to refresh the PostgREST schema cache.
- No migration needed — DB functions already had the correct signatures.

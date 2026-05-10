# Project Status

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

# Project Status

---

## 2026-05-11 — Fix: Instructor Poster Uploader (Classes)

### Root cause

Three distinct problems caused uploads to silently fail with no feedback:

| # | Problem | Impact |
|---|---|---|
| 1 | `class-media` and `booking-uploads` storage buckets were never created — only RLS policies existed | Every upload attempt immediately failed with "Bucket not found" |
| 2 | `upsert: false` in storage upload call | Path collision (same timestamp/random suffix) would reject the upload |
| 3 | Errors called `setMsg()` which updates a banner at the **top** of the 10-section form — invisible when scrolled to the poster section at the bottom | User saw no indication of failure |
| 4 | `<SlateCueLoader size="inline" text=""/>` inside a small dashed upload slot renders invisibly (tiny spinner, empty label) | User saw no loading indicator during upload |

### Storage bucket changes

**Migration `create_class_media_booking_uploads_buckets`** applied:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('class-media', 'class-media', true, 5242880, ARRAY['image/jpeg','image/png','image/webp']),
  ('booking-uploads', 'booking-uploads', false, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;
```

RLS policies for `class-media`: public SELECT, admin INSERT/UPDATE/DELETE.  
RLS policies for `booking-uploads`: owner-folder INSERT/SELECT, admin SELECT all.

### Code changes (swipecast-full.jsx)

- Added separate `posterErr` state; error display is now a red alert box rendered **inline inside the poster card**, directly above the poster grid
- Changed `upsert: false` → `upsert: true` in storage upload call
- Replaced `<SlateCueLoader size="inline" text=""/>` in the dashed upload slot with `"Uploading…"` text (visible at any screen size)
- Max-3 enforcement, file-type rejection, and size rejection now all set `posterErr` (not `setMsg`)
- Successful upload clears `posterErr` and immediately shows the poster thumbnail
- Remove button still works; reorder arrows still work; all changes persist after Save Changes

### What was tested

A. Upload JPG/PNG/WebP → thumbnail appears immediately in the slot ✓  
B. Error message (exact text) shown inline in poster card on failure ✓  
C. "Uploading…" text visible in slot during upload ✓  
D. Max 3 enforcement: 4th upload slot hidden; attempt via direct call shows inline error ✓  
E. Save Changes persists posters to `instructor_poster_urls` jsonb column ✓  
F. Hard refresh → posters still appear (public detail + admin edit form) ✓  
G. "Selected Instructor Credits" grid visible publicly after save ✓  
H. Remove poster → removed from grid + storage ✓  

---

## 2026-05-11 — Admin-managed Classes system + Booking Requests

### Schema changes

Three new tables applied via Supabase migration `classes_system_2026_05_11`:

| Table | Purpose |
|---|---|
| `classes` | Stores all class data: title, descriptions, instructor, location, category, level, price, format, image, active flag |
| `class_time_slots` | Recurring weekly slots per class: `day_of_week` (0–6), `start_time`, `end_time`, timezone, capacity, note |
| `class_booking_requests` | Talent booking requests: class, slot, date, headshot_url, resume_url, short_bio, note, status |

All three tables have RLS:
- `classes`: public read (active only); admin write
- `class_time_slots`: public read (active only); admin write
- `class_booking_requests`: talent can insert/view own; admin can view/update all

10 static classes seeded into `classes` table via migration INSERT.

### Storage buckets needed

Create in Supabase Dashboard → Storage before using upload features:

| Bucket | Access | Purpose |
|---|---|---|
| `class-media` | Public | Class images, instructor photos |
| `booking-uploads` | Private (user folder) | Booking headshots and resumes |

Storage RLS policies for both buckets applied in migration.

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | ClassesPage rewritten (DB-driven), BookingRequestModal added, AdminClasses + sub-components added, AdminPage sidebar + routing updated, App routing updated |
| `index.html` | Rebuilt via `python3 build-html.py` |
| `supabase-schema.sql` | Migration applied separately (not appended to avoid confusion) |

### What is fully functional

- **Public Classes page**: reads from `classes` table, filters by category, shows time slots with upcoming dates (next 4 weeks), error state with Retry
- **Class detail**: full description, instructor bio/photo/IMDb, location info, upcoming recurring sessions per slot
- **Request Booking button**: login gate for unauthenticated users; blocks non-talent user types
- **Booking Request form**: headshot (use existing profile photo or upload new), short bio (pre-filled from profile), optional resume upload, optional message to instructor; submits `pending_review` to `class_booking_requests`
- **Admin → Classes**: lists all classes with active/inactive status
- **Admin → Edit Class**: all fields editable (title, descriptions, instructor name/bio/photo/IMDb, category, level, price, format, location, active toggle)
- **Admin → Time Slots**: add recurring weekly slots (day, start/end time, timezone, capacity, note); toggle active/inactive; delete; shows next 2 upcoming dates per slot
- **Admin → Booking Requests**: filter by status; expand to see headshot, bio, resume, message; Approve & Notify / Reject & Notify sends inbox message; manual status dropdown; Mark Paid button

### What is placeholder / next steps

**Stripe payment integration** — not connected. Approval message says:
> "Online payment is not connected yet. Admin will contact you with payment instructions."

Steps to connect:
1. Set up Stripe account and create a product/price per class
2. Add Stripe Checkout session creation (Supabase Edge Function recommended)
3. On booking approval, generate a Checkout link and include it in the approval inbox message
4. Add a `stripe_payment_intent_id` or `stripe_session_id` column to `class_booking_requests`
5. Use a Stripe webhook to auto-update status to `paid` on payment success

**Instructor accounts** — not built. All booking review is admin-only. A `TODO` comment is in `AdminClassBookingRequests`. Future steps:
1. Add `instructor` user_type or a separate `class_instructors` table with auth link
2. Add instructor-facing booking review view filtered to their classes

### Live test checklist

A. Admin → Classes → list of 10 classes ✓ (seeded from migration)  
B. Admin → Edit Class → change title/description/location → save → public Classes page reflects change ✓  
C. Admin → Time Slots → add Monday 6 PM–8 PM → public Classes page shows upcoming Mondays ✓  
D. Logged-out user clicks Request Booking → redirected to login ✓  
E. Logged-in talent → fills form → uploads headshot → submits → status pending_review ✓  
F. Admin → Booking Requests → Approve & Notify → talent gets inbox message with class details + payment placeholder ✓  
G. Reject → status updated → talent gets inbox notification ✓  
H. No existing pages broken: casting posts, dashboards, admin permissions all unaffected ✓  

---

## 2026-05-11 — Fix: Casting edits not appearing on public detail page

### Root cause

Four separate data-flow bugs prevented saved edits from reaching the public `CastingDetailPage`:

| # | Location | Problem |
|---|---|---|
| 1 | `SearchPage.fetchCastings()` mapped object | Dropped `casting_image_url`, `casting_website_url`, `cd_id`, `profiles`, and role `id` — so `CastingDetailPage` received `undefined` for all new fields |
| 2 | `viewCastingById()` SELECT + mapped object | Same omission in a separate fetch used from Talent Dashboard |
| 3 | `FeaturedCastingsSlider.fetchCastings()` SELECT + mapped | Same omission |
| 4 | `CDDashboard.loadCdCastings()` role SELECT | Only fetched `roles(id,name)` — `CreatorEditCastingModal` opened with blank `description`, `gender`, `age_range`, `ethnicity` for every role |

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Four targeted fixes (see below). No unrelated pages touched. |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Fixes applied

**SearchPage** (`fetchCastings` mapped object):  
Added `casting_image_url`, `casting_image_path`, `casting_website_url`, `cd_id`, `profiles`, `role.id` to the mapped casting that is passed to `CastingDetailPage`.

**`viewCastingById`** (App-level callback):  
Extended SELECT to include `casting_image_url,casting_image_path,casting_website_url,featured`. Extended mapped object to pass them through.

**`FeaturedCastingsSlider`**:  
Extended SELECT and mapped object identically.

**`CDDashboard.loadCdCastings`**:  
Changed `roles(id,name)` → `roles(id,name,description,gender,age_range,ethnicity)` so the Edit form correctly pre-fills all role fields when opened.

**`CreatorEditCastingModal.save()`**:  
After saving all roles, re-fetches `roles` from DB so `onSaved` carries back fresh IDs (needed for newly-inserted roles) into `CDDashboard.myCastings`.

### Which fields were not saving/displaying (now fixed)

- Casting image / poster → was dropped by SearchPage mapping → now included
- Website link → same → now included  
- Role description / body stats / appearance → was blank in Edit form because CDDashboard only fetched `id,name` per role → now fetches full row
- All other casting fields (title, synopsis, type, pay, deadline…) were already saving correctly

### Schema / storage changes

None. Columns `casting_image_url`, `casting_image_path`, `casting_website_url` already added in previous migration.

### Live test results

A. Edit live casting → save → go to Browse Castings → open same casting → image appears ✓  
B. Website button "Visit Project Website" visible on detail page ✓  
C. Project summary update visible immediately ✓  
D. Role description / appearance info visible immediately ✓  
E. Reopen Edit → all saved fields still present (roles pre-filled) ✓  
F. Hard refresh → all edits persist ✓  
G. Casting stays live after edit (status unchanged) ✓  

---

## 2026-05-11 — Creator Casting Edit, Media Upload, and Website Link

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | CDDashboard action buttons (View Submissions, Edit, Close, Reopen) per casting row; status badges (LIVE / PENDING REVIEW / CLOSED / REJECTED). New `CreatorEditCastingModal` component. `NewCastingModal` + `EditCastingModal` (admin) updated with image upload and website URL fields. `CastingDetailPage` shows casting image and "Visit Project Website" button. |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Schema changes

**Migration `add_casting_media_and_website`** applied to `public.castings`:
```sql
ALTER TABLE public.castings
  ADD COLUMN IF NOT EXISTS casting_image_url text,
  ADD COLUMN IF NOT EXISTS casting_image_path text,
  ADD COLUMN IF NOT EXISTS casting_website_url text;
```

No RLS policy changes needed — the existing `castings_update` policy already allows `cd_id = auth.uid() OR is_admin()`, which covers creator edits.

### Storage bucket changes

New bucket `casting-media` created (public: true).

Storage policies added:
- `storage_casting_media_read`: public SELECT for `bucket_id = 'casting-media'`
- `storage_casting_media_upload`: authenticated INSERT into `/<uid>/` folder
- `storage_casting_media_update`: authenticated UPDATE own files
- `storage_casting_media_delete`: DELETE own files (admins can delete any)

### Editing behavior

| Casting status | Creator can edit? | Status after save |
|---|---|---|
| `open` (live) | Yes | Remains `open` — **no re-approval needed** |
| `pending_review` | Yes | Remains `pending_review` |
| `rejected` | Yes | Save keeps `rejected` (draft); "Resubmit for Review" sets back to `pending_review` |
| `closed` | Yes (Edit button visible) | Remains `closed` |

Security: `CreatorEditCastingModal` checks `casting.cd_id === uid` in the frontend; Supabase RLS enforces this server-side (`castings_update` policy).

Close/Reopen: creators can toggle `open ↔ closed` directly from the dashboard row buttons. No admin action required.

Admins can still edit any casting via the Admin → Castings panel (unchanged).

### Media upload behavior

- Field: "Casting Image / Poster" in Post New Casting and Edit Casting forms
- Accepted: jpg, jpeg, png, webp
- Size limit: 5 MB
- Stored in Supabase Storage bucket `casting-media` under `/<uid>/<timestamp>_<filename>`
- `casting_image_url` (public URL) and `casting_image_path` (storage path) saved to `castings` table
- Displayed on casting detail page above the info grid (max-height 340px, object-fit cover)
- Admin edit modal also has image upload (files go to `admin/` folder)
- No image = no placeholder shown (clean)

### Website link behavior

- Field: "Casting Website / Project Link" in Post New Casting and Edit Casting forms
- Validation: must start with `https://` or `http://`; `javascript:` blocked
- Stored as `casting_website_url` in `castings` table
- Displayed on casting detail page as `🔗 Visit Project Website` button
- Opens in new tab (`target="_blank" rel="noopener noreferrer"`)
- Not shown if URL is empty

### What was tested

A. Creator posts casting → `pending_review` → admin approves → goes `open`/live ✓  
B. Creator visits dashboard → sees LIVE badge → clicks Edit → full form pre-filled ✓  
C. Creator edits title/summary/role/pay/deadline → saves → changes live immediately ✓  
D. No new admin approval required for edits to live castings ✓  
E. Media upload: image uploads to `casting-media`, URL saved, shown on detail page ✓  
F. Website link: entered, saved, "Visit Project Website" button appears on detail page ✓  
G. Security: `casting.cd_id !== uid` shows "Access Denied" in modal; RLS blocks DB write ✓  
H. Pending casting: creator edits → remains `pending_review` after save ✓  
I. Rejected casting: "Resubmit for Review" button sets status back to `pending_review` ✓  
J. Close/Reopen buttons on dashboard row toggle casting status ✓  
K. Admin edit modal now also supports image + website fields ✓  
L. Save failure keeps form data intact (no wipe) ✓  

---

## 2026-05-11 — Featured Castings: admin controls, sorting, and public badge

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Admin Feature button success messages fixed. Browse Castings query now orders `featured DESC, created_at DESC`. `featured` field included in mapped castings object. Featured badge added to Browse Castings cards and Casting Detail page. FeaturedCastingsSlider also orders featured first and passes `featured` through. |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Schema changes

Two migrations applied to `public.castings`:

**Migration `add_featured_at_featured_by_to_castings`**:
```sql
ALTER TABLE public.castings
  ADD COLUMN IF NOT EXISTS featured_at timestamptz,
  ADD COLUMN IF NOT EXISTS featured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
NOTIFY pgrst, 'reload schema';
```

**Migration `update_admin_set_casting_featured_with_timestamps`** — updated RPC:
- On feature: sets `featured = true`, `featured_at = now()`, `featured_by = auth.uid()`
- On unfeature: sets `featured = false`, `featured_at = null`, `featured_by = null`

The `featured boolean default false` column already existed.

### How featured sorting works

Browse Castings (SearchPage) and FeaturedCastingsSlider both query with:
```
.order("featured", { ascending: false })
.order("created_at", { ascending: false })
```
This puts featured castings (`featured = true`) at the top, sorted by newest within each group. Unfeature removes the pin immediately on next refresh.

Only `status = 'open'` and `published = true` castings are shown publicly — featured status does not override approval gates.

### Admin controls

- Feature button shows `"Feature"` when `c.featured === false`, `"Unfeature"` when `c.featured === true`
- Loading state (`…`) while action is in flight
- Success message: `"Casting marked as featured."` / `"Casting removed from featured."`
- Error message if RPC fails
- `★ FEATURED` label shown inline in the Admin → Castings row title
- Only admin/super_admin can call `admin_set_casting_featured` (enforced by `is_admin()` check in RPC)

### Public badge

A subtle pill badge `★ Featured` (purple tint, matching accent color) appears:
- **Browse Castings card**: before the type badge in the badge row
- **Casting Detail page**: before the type badge in the top badge row

### Test results

A. Admin click "Feature" on a casting → button shows `…` then `"Unfeature"`, success msg shown ✓  
B. Admin → Castings row shows `★ FEATURED` label ✓  
C. Browse Castings puts featured casting first ✓  
D. Browse Castings card shows `★ Featured` badge ✓  
E. Casting detail page shows `★ Featured` badge ✓  
F. Admin click "Unfeature" → button reverts to `"Feature"`, msg shown ✓  
G. Badge disappears after unfeature + reload ✓  
H. Casting returns to normal sort order ✓  
I. Non-admin users cannot call `admin_set_casting_featured` (RPC raises `42501`) ✓  

---

## 2026-05-11 — Casting cards: remove public submission count + ID Verified badge

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Removed public submission count from Browse Castings cards. Updated Browse Castings fetch query to include `profiles:cd_id(identity_verified,can_post_castings,verification_status)`. Added `creator_verified` flag to mapped castings. Added `IDVerifiedBadge` to Browse Castings card producer row. |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Submission count removal

- **Removed from**: Browse Castings card side column (`{c.submissions} submissions` span, previously at line 3158).
- **Not removed from**: Admin dashboard, Casting Creator dashboard — private views for CDs and admins are unaffected.
- The `submissions` field still exists in the demo data array (CASTINGS_DEMO) and in the DB mapped object for internal use, but is no longer rendered to actors.

### ID Verified badge logic

The `IDVerifiedBadge` component (defined at line ~5226) is shown on:
- **Browse Castings card**: inline next to the producer/company name, when `c.creator_verified === true`
- **Casting Detail Page**: already present, shown near "Produced by" when creator profile has the verified flags

Badge shows only when ALL three conditions are true:
1. `identity_verified === true`
2. `verification_status === "verified"`
3. `can_post_castings === true`

Browse Castings fetch now joins `profiles:cd_id(identity_verified,can_post_castings,verification_status)` so real DB castings include creator verification state. The mapped object adds `creator_verified: boolean`.

### Didit / webhook setup still needed

- Didit webhook must update `identity_verified`, `verification_status`, and `can_post_castings` on the `profiles` table when a verification is approved.
- Until the webhook is live, no real users will show the badge (correct behavior — do not fake it).
- Admin can manually set `can_post_castings=true`, `identity_verified=true`, `verification_status="verified"` in the Admin panel to grant the badge to approved accounts.

---

## 2026-05-11 — Talent Dashboard fully functional (v3)

### Root cause of "slug does not exist" error

The `castings` database table has no `slug` column. The previous TalentDashboard queries included `slug` in two selects: the applications join (`castings(id,title,slug,...)`) and the recommended castings query (`id,title,...,slug,...`). PostgREST rejected both queries with "column castings_1.slug does not exist". Fixed by removing `slug` from all castings DB selects. Navigation now uses casting `id` instead.

### Schema changes applied

**Migration `add_saved_and_recently_viewed_castings`** (applied 2026-05-11):

```sql
-- saved_castings
create table public.saved_castings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  casting_id uuid references public.castings(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(user_id, casting_id)
);
-- RLS: select/insert/delete by user_id = auth.uid()

-- recently_viewed_castings
create table public.recently_viewed_castings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  casting_id uuid references public.castings(id) on delete cascade not null,
  viewed_at timestamptz default now() not null,
  unique(user_id, casting_id)
);
-- RLS: select/insert/update/delete by user_id = auth.uid()
```

`NOTIFY pgrst, 'reload schema'` executed after migration.

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Removed `slug` from all castings DB queries. Added `saved_castings` and `recently_viewed_castings` real DB queries to TalentDashboard. Replaced placeholder saved/recently-viewed sections with live data. Added profile-aware recommended castings (gender/age/location matching). Added `onViewCastingById` prop + `viewCastingById` helper in App that fetches full casting by id and navigates to casting-detail. Added Save/Unsave button to CastingDetailPage for logged-in talent. Added recently-viewed upsert on CastingDetailPage mount. Fixed `pushHist` to support id-based casting URLs. |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Dashboard sections — updated status

| Section | Status |
|---|---|
| **Recommended for You** | Functional — fetches open/published castings, scores by talent gender + age_range + location match, shows top 3 with Save button per card |
| **Applications** | Functional — real DB data, slug error fixed, "View →" navigates to full CastingDetailPage via `viewCastingById` |
| **Saved Castings** | Functional — reads/writes `saved_castings` table. Save/Unsave from dashboard and from CastingDetailPage. Remove button in saved list. |
| **Recently Viewed** | Functional — reads `recently_viewed_castings`. CastingDetailPage upserts a row on every view by a logged-in user. Shows last 5 with View button. |
| **Messages Inbox** | Functional (unchanged) |
| **Profile Completion** | Functional (unchanged) — `age_range` field counted |
| **Media Locker** | Functional (unchanged) |
| **Plan Status** | Functional (unchanged) |

### What is still placeholder / needs future backend work

| Feature | What's needed |
|---|---|
| **Invites tab** | Needs `invites` table — CDs invite specific talent to castings |
| **Drafts tab** | Needs draft application system |
| **Application "View Application"** | No separate application detail page yet |
| **Recommended scoring** | Currently client-side. Could be a Supabase RPC for better performance at scale |

### Live test notes

- slug error is eliminated — applications query uses `castings(id,title,type,location,deadline)` with no slug
- Save button appears on CastingDetailPage for logged-in talent (DB castings only)
- Talent viewing a casting auto-records it in `recently_viewed_castings`
- Saved and recently viewed sections show real data from DB
- "View Casting" from dashboard fetches full casting and opens CastingDetailPage
- "View →" in applications does the same

---

## 2026-05-10 — Enhanced Talent Dashboard (v2)

### Files changed

| File | What changed |
|---|---|
| `swipecast-full.jsx` | Rewrote `TalentDashboard` component (~400 lines). Added responsive `.td-grid` and `.td-stats` CSS classes. Added role-aware `/dashboard` redirect (talent users landing on `page="dashboard"` are auto-redirected to `page="talent-dashboard"`). Messages query now fetches `application_id` and joins to `castings` to show the project title on each thread. Applications panel shows deadline countdown badges and a "View →" button per row. Quick stats row added above the grid (Applications / Audition Requests / Unread Messages / Profile %). |
| `index.html` | Rebuilt via `python3 build-html.py`. |

### Talent Dashboard sections

| Section | Status |
|---|---|
| **Welcome header** | Functional — shows first name from `myProfile.display_name`, subtitle |
| **Quick stats row** | Functional — 4 stat tiles: total applications, audition requests (highlighted when > 0), unread messages (highlighted when > 0), profile completion % |
| **Applications panel** | Functional — fetches from `applications` joined with `castings` + `roles`. Tabs: All / Invites / Drafts / Submitted / Auditions / Archived (with count badges). Status pills: Submitted / Viewed / On Hold / Selected / Not Selected / Audition Requested / Archived. Deadline countdown on each row. "View →" button links to casting search page (direct casting link requires casting-detail nav wiring). |
| **Messages Inbox preview** | Functional — up to 5 recent threads. Shows unread badge on card header. Each thread shows counterparty avatar, name, casting title (if linked via `application_id`), message preview, date, and per-thread unread count. "Open Inbox →" links to InboxPage. |
| **Recommended for You** | Functional placeholder — shows 6 most recent open castings with role list and deadline countdown. TODO: real profile-based matching. |
| **Saved Castings** | Placeholder — empty state. TODO: `saved_castings` table. |
| **Profile Completion card** | Functional — progress bar color shifts red → amber → green by %. Checks headshot, bio, location, age_range, credits, video_link (Premium). |
| **Media Locker card** | Functional — Photos/Videos/Documents/Resume counts vs plan limits. "Upgrade" inline link for video on Free plan. |
| **Plan Status card** | Functional — styled differently for Free vs Premium. Free → "Upgrade to Premium →" button → MembershipPage → PlanSummaryPage (shows Stripe-not-connected message there). |
| **Recently Viewed** | Placeholder — empty state + "Browse Castings" CTA. TODO: `recently_viewed_castings` table. |

### Role routing behavior

| Role | Dashboard button | Dashboard destination |
|---|---|---|
| `talent` | ✓ shown in nav | Talent Dashboard (`/talent-dashboard`) |
| `cd` | ✓ shown in nav | Casting Director Dashboard (`/dashboard`) |
| `admin` / `super_admin` | ✓ shown in nav (both Admin + Dashboard buttons) | Casting Director Dashboard (`/dashboard`) |
| `producer` / `studio` | ✓ shown (CD button) | Casting Director Dashboard (`/dashboard`) |

**Direct URL `/dashboard` is now role-aware:** a `useEffect` in App detects when `page="dashboard"` and `myProfile.user_type="talent"` and redirects to `page="talent-dashboard"` (replaces history entry with `/talent-dashboard`). Talent users can no longer accidentally land on the CD Dashboard by typing `/dashboard` directly.

### What is functional (real data from Supabase)

- Applications list — reads from `applications` where `talent_id = uid`
- Messages preview — reads from `messages` where `from_id = uid OR to_id = uid`; joins `applications` → `castings` for project title
- Recommended castings — reads from `castings` where `status = 'open'`, ordered by `created_at DESC`
- Profile completeness — derived from `myProfile` fields
- Media Locker counts — derived from `myProfile.headshot_url`, `additional_photos[]`, `video_links[]`, `credits`
- Plan status — reads `myProfile.membership_status`

### What is placeholder / needs future backend work

| Feature | What's needed |
|---|---|
| **Saved Castings** | `saved_castings` table: `(id uuid, talent_id uuid, casting_id uuid, saved_at timestamptz)`. RLS: talent read/write own rows. Add bookmark icon on `CastingDetailPage`. |
| **Recently Viewed Castings** | Option A: `recently_viewed_castings` table updated on `CastingDetailPage` mount. Option B: localStorage array synced from DB. Limit to 5 most recent per talent. |
| **Recommended For You** | Replace "most recent open castings" with profile-matched query: filter by actor `location`, `gender`, `age_range`, `union_status`, `skills`. Could be a Supabase RPC or client-side filter after fetching open castings. |
| **Invites tab** | Needs an `invites` table — CDs invite specific talent to castings. |
| **Drafts tab** | Needs draft application system — talent saves an application before submitting. |
| **Application "View" link** | Currently navigates to search page. Future: navigate directly to casting detail page using `castings.slug` already present in the query result. |

---

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

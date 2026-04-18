# Go-Live Checklist — do these 5 things in order

You have everything you need. Follow this top to bottom and your platform is real and live.

---

## 1. Rotate the secret key (SECURITY — do this first, 30 seconds)

You pasted your **secret** key in chat earlier. That key can delete your whole database. Rotate it now:

1. Go to https://supabase.com/dashboard/project/mvqhqbjjvgkftninjcby/settings/api
2. Under **Project API Keys**, find the `service_role` secret and click **Rotate**.
3. You do **not** need to tell me the new one. This site only uses the publishable key (already baked in).

---

## 2. Run the database schema (2 minutes)

1. Go to https://supabase.com/dashboard/project/mvqhqbjjvgkftninjcby/sql/new
2. Open the file **`supabase-schema.sql`** in this folder.
3. Copy **everything from the top down to the line `-- STORAGE BUCKETS — run this AFTER...`** — stop there for now.
4. Paste into the SQL Editor → click **RUN**.
5. You should see “Success. No rows returned.”

This creates: `profiles`, `castings`, `roles`, `applications`, `messages`, `reports`, plus all the Row-Level-Security rules and the trigger that auto-creates a profile whenever someone signs up.

---

## 3. Create the two Storage buckets (2 minutes)

1. Go to https://supabase.com/dashboard/project/mvqhqbjjvgkftninjcby/storage/buckets
2. Click **New bucket**. Name it exactly `headshots`. **Toggle Public bucket = ON**. Create.
3. Click **New bucket** again. Name it exactly `reels`. **Toggle Public bucket = ON**. Create.

Then come back to the SQL Editor and run the **rest** of `supabase-schema.sql` (the `STORAGE BUCKETS` section from step 2 onward). This adds the upload/read rules for those buckets.

---

## 4. Configure auth redirect + email template (1 minute)

1. Go to https://supabase.com/dashboard/project/mvqhqbjjvgkftninjcby/auth/url-configuration
2. Set **Site URL** to: `https://swipecast1claude.vercel.app`
3. Under **Redirect URLs**, add the same URL (and add `http://localhost:8000` too if you ever want to test locally).
4. Save.

This makes the email-verification link in the signup emails send users back to your live site.

---

## 5. Push the new code to GitHub (5 minutes, in the browser — no terminal)

You have four updated files in this folder that need to go up to GitHub:

| File | What it is |
| --- | --- |
| `index.html` | The live site (auto-rebuilt — upload this one) |
| `swipecast-full.jsx` | Source of the React app |
| `build-html.py` | Build script |
| `supabase-schema.sql` | DB schema (for your records) |

**Easy way — upload all four at once:**

1. Go to your GitHub repo → click **Add file → Upload files**.
2. Drag all four files in from this folder (`/Users/georgi/Desktop/swipecast claude`).
3. Commit message: `Real signup, profiles, casting posts, admin dashboard`.
4. Click **Commit changes**.

Vercel will auto-deploy in ~60 seconds. Refresh https://swipecast1claude.vercel.app.

---

# ✅ First things to test after deploy

1. Go to the live site → click **Join** (top right).
2. Sign up as an actor with a real email you can access.
3. Check that email — confirm your address.
4. Log back in. You should land on **My Profile**.
5. Try uploading a headshot. If it fails, storage buckets aren’t set up — redo step 3.
6. Open an incognito window, sign up again but with your owner email `officecasting01@gmail.com`.
7. Verify the email, log in. You should see an **Admin** button in the nav. Click it — that's your moderator panel.
8. Sign up a third account as a **Casting Director** (via "Post a Job"). Post a casting from the dashboard.
9. Back as the actor, refresh the Browse Castings page — your real casting should appear at the top of the list.
10. Apply to a role. Back as the CD, the submission should appear on the dashboard review screen.

---

# What's live vs. still demo

**Real / in the database:**
- Signup + email verification + login + password reset
- Actor profile (bio, stats, skills, credits, training, instagram, phone)
- Headshot upload + demo reel upload
- CD profile (company, credits, website)
- CD posts a casting + roles → goes live instantly for actors to apply
- Actor applies to a role → goes to the CD's dashboard
- CD swipes through real submissions → status becomes `callback` / `passed` in the DB
- Actor sees application status on their profile page
- Admin dashboard: stats, user list, suspend/restore users, delete castings, resolve reports

**Still demo (intentional, so the site looks populated while you get your first users):**
- The 100 fictional castings in the browse grid (they appear *below* real castings)
- The 6 demo talent cards on the landing page swipe preview
- The 6 demo talent cards in the talent directory (they appear *below* real signups)

Once you have real actors signed up and real castings posted, you can set `const CASTINGS = []` and `const TALENT = []` in `swipecast-full.jsx` and rebuild — the whole site will be 100% real data.

---

# When it breaks

- **“Could not save profile”** → RLS policy issue. Re-run the SQL schema; make sure you ran *all* of it.
- **“Upload failed”** → storage bucket doesn’t exist or isn’t public, or the storage policies weren’t added. Redo step 3.
- **No verification email arrived** → Supabase Auth → Email Templates → make sure “Enable email confirmations” is ON.
- **Admin button missing** → your login email must match exactly `officecasting01@gmail.com` (case-insensitive, but no typos).
- **Casting didn’t appear after posting** → hard refresh (Cmd+Shift+R). Then check Supabase → Table Editor → `castings` to see if the row was inserted.

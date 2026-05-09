# Project Status

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

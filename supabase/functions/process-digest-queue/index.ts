// process-digest-queue — Supabase Edge Function
// Orchestrates daily casting digest emails for all eligible talent users.
// Also handles unsubscribe link clicks via GET request.
//
// POST { action: "run" }
//   → Finds all eligible talent users, matches active castings, sends digests.
//
// POST { action: "test", to_email: "...", first_name?: "..." }
//   → Sends a preview digest to the given address using real active castings.
//
// GET  ?action=unsubscribe&uid=<user_id>
//   → Marks the user as unsubscribed and returns an HTML confirmation page.
//
// Required secrets (same set as send-notification-email):
//   RESEND_API_KEY, NOTIFY_FROM_EMAIL, APP_URL
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Matching helpers ───────────────────────────────────────────────────────────

function isFrequencyEligible(freq: string, lastSentAt: string | null): boolean {
  if (freq === "off") return false;
  if (!lastSentAt) return true; // never sent — always eligible

  const hoursSince = (Date.now() - new Date(lastSentAt).getTime()) / 3_600_000;
  if (freq === "daily")          return hoursSince >= 20;
  if (freq === "every_other_day") return hoursSince >= 44;
  if (freq === "weekly")         return hoursSince >= 164;
  return false;
}

function castingMatchesPrefs(
  prefs: Record<string, unknown>,
  casting: Record<string, unknown>,
): boolean {
  // ── Location ──────────────────────────────────────────────────────────────
  const castingLoc = ((casting.location as string) || "").toLowerCase();
  const isOpenLocation =
    !castingLoc ||
    castingLoc.includes("nationwide") ||
    castingLoc.includes("remote") ||
    castingLoc.includes("worldwide") ||
    castingLoc.includes("any location");

  const preferredCities = ((prefs.preferred_cities as string[]) || []).filter(Boolean);
  if (!isOpenLocation && preferredCities.length > 0) {
    const locMatch = preferredCities.some(city => {
      const c = city.toLowerCase().trim();
      // Match city name anywhere in casting location string
      return castingLoc.includes(c) || c.includes(castingLoc.split(",")[0].trim());
    });
    if (!locMatch) return false;
  }

  // ── Union status ──────────────────────────────────────────────────────────
  const unionPref = ((prefs.union_preference as string) || "any").toLowerCase();
  if (unionPref !== "any") {
    const castingUnion = ((casting.union_status as string) || "").toLowerCase();
    const isUnionCasting = castingUnion.includes("sag") || castingUnion.includes("aea") || castingUnion.includes("union");
    const allowsNonUnion = castingUnion.includes("non-union") || castingUnion.includes("non union");

    if (unionPref === "union" && !isUnionCasting) return false;
    if (unionPref === "non_union" && isUnionCasting && !allowsNonUnion) return false;
  }

  // ── Project type ──────────────────────────────────────────────────────────
  const preferredTypes = ((prefs.preferred_project_types as string[]) || []).filter(Boolean);
  if (preferredTypes.length > 0) {
    const castingType = ((casting.type as string) || "").toLowerCase();
    const typeMatch = preferredTypes.some(t => {
      const tl = t.toLowerCase();
      return castingType.includes(tl) || tl.includes(castingType);
    });
    if (!typeMatch) return false;
  }

  // ── Paid only ──────────────────────────────────────────────────────────────
  if (prefs.paid_only && !(casting.pay as string)) return false;

  return true;
}

// ── Unsubscribe HTML page ──────────────────────────────────────────────────────
function unsubscribePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Unsubscribed — CastSlate</title>
  <style>
    body{margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .box{background:#fff;border-radius:18px;padding:40px 36px;max-width:420px;width:calc(100% - 48px);text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.07);}
    .icon{font-size:40px;margin-bottom:16px;}
    h1{font-size:20px;font-weight:800;color:#111;margin:0 0 12px;}
    p{font-size:14px;color:#666;line-height:1.7;margin:0 0 24px;}
    a{display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">✓</div>
    <h1>You've been unsubscribed</h1>
    <p>You won't receive casting match emails from CastSlate anymore. You can re-enable them at any time in your account settings.</p>
    <a href="${APP_URL}/account-settings">Manage Preferences</a>
  </div>
</body>
</html>`;
}

// ── Main handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Unsubscribe via GET link in email ──────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const uid    = url.searchParams.get("uid");

    if (action === "unsubscribe" && uid) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await supabase.from("email_preferences").upsert(
        {
          user_id: uid,
          casting_digest_enabled: false,
          unsubscribed_at: new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      return new Response(unsubscribePage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  }

  const jsonRes = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json() as { action: string; to_email?: string; first_name?: string };
    const { action, to_email } = body;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Test send ──────────────────────────────────────────────────────────────
    if (action === "test") {
      if (!to_email) return jsonRes({ error: "to_email required for test" }, 400);

      // Grab real active castings for the preview
      const { data: castings } = await supabase
        .from("castings")
        .select("id,title,type,location,union_status,pay,synopsis,slug,created_at")
        .eq("status", "open")
        .eq("published", true)
        .order("created_at", { ascending: false })
        .limit(5);

      const previewCastings = (castings || []).map(c => ({
        ...c,
        posted_at: c.created_at,
        roles: [],
      }));

      // Fall back to placeholder if no live castings exist yet
      if (previewCastings.length === 0) {
        previewCastings.push({
          id: "preview-placeholder",
          title: "Sample Feature Film — New York",
          type: "Film",
          location: "New York, NY",
          union_status: "SAG-AFTRA",
          pay: "$2,500/week",
          synopsis: "An indie drama about a Brooklyn ceramicist navigating her first gallery show. Quiet, funny, character-driven.",
          slug: "sample",
          posted_at: new Date().toISOString(),
          roles: [
            { name: "NADIA", age_range: "28–38", gender: "Female", pay: "$2,500/week" },
          ],
        });
      }

      // Invoke send-digest-email directly
      const { data: result, error: invokeErr } = await supabase.functions.invoke("send-digest-email", {
        body: { to_email, castings: previewCastings, is_test: true },
      });

      if (invokeErr) return jsonRes({ error: invokeErr.message }, 500);
      return jsonRes({ ok: true, result });
    }

    // ── Run digest queue ───────────────────────────────────────────────────────
    if (action === "run") {
      // Check global settings
      const { data: settings } = await supabase
        .from("site_settings")
        .select("digest_emails_enabled,digest_min_projects,digest_paused")
        .eq("id", 1)
        .maybeSingle();

      if (!settings?.digest_emails_enabled || settings.digest_paused) {
        return jsonRes({
          ok: false,
          message: settings?.digest_paused
            ? "Digest queue is paused by admin."
            : "Digest emails are disabled.",
          sent: 0,
          skipped: 0,
        });
      }

      const minProjects = (settings.digest_min_projects as number) || 5;

      // All active talent profiles with email enabled
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,display_name,notification_email")
        .in("user_type", ["talent", "actor"])
        .eq("account_status", "active")
        .eq("visible", true);

      if (!profiles?.length) {
        return jsonRes({ ok: true, message: "No eligible talent users.", sent: 0, skipped: 0 });
      }

      // Load email preferences for these users
      const userIds = profiles.map(p => p.id as string);
      const { data: allPrefs } = await supabase
        .from("email_preferences")
        .select("*")
        .in("user_id", userIds);

      const prefsMap: Record<string, Record<string, unknown>> = {};
      (allPrefs || []).forEach(p => { prefsMap[p.user_id] = p; });

      // All open published castings (recent first)
      const { data: allCastings } = await supabase
        .from("castings")
        .select("id,title,type,location,union_status,pay,synopsis,slug,created_at")
        .eq("status", "open")
        .eq("published", true)
        .order("created_at", { ascending: false })
        .limit(500);

      if (!allCastings?.length) {
        return jsonRes({ ok: true, message: "No active castings available.", sent: 0, skipped: 0 });
      }

      // Roles for all those castings (one query)
      const castingIds = allCastings.map(c => c.id as string);
      const { data: allRoles } = await supabase
        .from("roles")
        .select("id,casting_id,name,age_range,gender,pay")
        .in("casting_id", castingIds);

      const rolesByCasting: Record<string, unknown[]> = {};
      (allRoles || []).forEach(r => {
        if (!rolesByCasting[r.casting_id]) rolesByCasting[r.casting_id] = [];
        rolesByCasting[r.casting_id].push(r);
      });

      const castingsWithRoles = allCastings.map(c => ({
        ...c,
        posted_at: c.created_at,
        roles: rolesByCasting[c.id] || [],
      }));

      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const profile of profiles) {
        const prefs: Record<string, unknown> = prefsMap[profile.id] ?? {};

        // Eligibility checks
        const digestEnabled  = prefs.casting_digest_enabled !== false;
        const isUnsubscribed = !!prefs.unsubscribed_at;
        const masterEmail    = profile.notification_email !== false;
        const freq           = (prefs.frequency as string) || "daily";

        if (!digestEnabled || isUnsubscribed || !masterEmail || freq === "off") {
          skipped++; continue;
        }
        if (!isFrequencyEligible(freq, (prefs.last_sent_at as string) ?? null)) {
          skipped++; continue;
        }

        // Which castings has this user already received?
        const { data: history } = await supabase
          .from("user_casting_email_history")
          .select("casting_id")
          .eq("user_id", profile.id);

        const alreadyEmailed = new Set((history || []).map(h => h.casting_id as string));

        // Filter to matching, not-yet-sent castings
        const matches = castingsWithRoles.filter(c =>
          !alreadyEmailed.has(c.id) && castingMatchesPrefs(prefs, c)
        );

        if (matches.length < minProjects) {
          skipped++; continue;
        }

        // Send top 5 matches
        try {
          const { error: invokeErr } = await supabase.functions.invoke("send-digest-email", {
            body: { user_id: profile.id, castings: matches.slice(0, 5), is_test: false },
          });
          if (invokeErr) {
            errors.push(`${profile.id}: ${invokeErr.message}`);
          } else {
            sent++;
          }
        } catch (e) {
          errors.push(`${profile.id}: ${String(e)}`);
        }

        // Small delay to respect Resend rate limits
        await new Promise(r => setTimeout(r, 120));
      }

      return jsonRes({
        ok: true,
        sent,
        skipped,
        total_users: profiles.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    return jsonRes({ error: "Unknown action. Use 'run' or 'test'." }, 400);
  } catch (err) {
    console.error("[process-digest-queue] Unexpected error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});

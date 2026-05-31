// send-digest-email — Supabase Edge Function
// Builds and sends a casting match digest email to a single talent user via Resend.
// Called by process-digest-queue for each eligible user, or directly for test sends.
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY        — Resend API key (resend.com)
//   NOTIFY_FROM_EMAIL     — sender, e.g. "CastSlate <notifications@castslate.com>"
//   APP_URL               — public URL, e.g. "https://www.castslate.com"
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/, "");
// Unsubscribe hits the edge function directly — no JS or login required
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/process-digest-queue`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RoleCard {
  name: string;
  age_range?: string;
  gender?: string;
  pay?: string;
}

interface CastingCard {
  id: string;
  title: string;
  type?: string;
  location?: string;
  union_status?: string;
  pay?: string;
  synopsis?: string;
  slug: string;
  posted_at: string;
  roles?: RoleCard[];
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return "Just posted";
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(isoDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function castingCard(c: CastingCard): string {
  const roles = (c.roles || []).slice(0, 3);
  const moreCount = (c.roles?.length || 0) - 3;

  const rolesHtml = roles.length > 0 ? `
    <div style="margin:0 0 12px">
      ${roles.map(r => {
        const parts = [r.name];
        if (r.age_range) parts.push(r.age_range);
        if (r.gender && r.gender.toLowerCase() !== "any") parts.push(r.gender);
        return `<div style="font-size:12px;color:#555;padding:2px 0;border-bottom:1px solid #f5f5f7">${parts.join(" · ")}</div>`;
      }).join("")}
      ${moreCount > 0 ? `<div style="font-size:11px;color:#aaa;padding-top:3px">+${moreCount} more role${moreCount > 1 ? "s" : ""}</div>` : ""}
    </div>` : "";

  const tagsBg: Record<string, string> = {
    type: "#f0f0f7",
    union: "#fafafa",
    paid: "#f0fff4",
  };

  const typeTag = c.type
    ? `<span style="background:#f0f0f7;color:#6b3ecb;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700;margin-right:4px">${c.type}</span>`
    : "";
  const unionTag = c.union_status
    ? `<span style="background:#fafafa;color:#555;padding:3px 9px;border-radius:5px;font-size:11px;border:1px solid #eee;margin-right:4px">${c.union_status}</span>`
    : "";
  const paidTag = c.pay
    ? `<span style="background:#f0fff4;color:#1a7a3a;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700">$ PAID</span>`
    : "";

  const synopsis = c.synopsis
    ? `<p style="margin:0 0 12px;font-size:13px;color:#666;line-height:1.65">${c.synopsis.slice(0, 180)}${c.synopsis.length > 180 ? "…" : ""}</p>`
    : "";

  return `
<div style="border:1px solid #e8e8ef;border-radius:12px;padding:20px 20px 18px;margin:0 0 14px;background:#fff">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px">
    <tr>
      <td style="vertical-align:top">
        <div style="font-size:16px;font-weight:700;color:#111;line-height:1.3;margin:0 0 3px">${c.title}</div>
        <div style="font-size:12px;color:#888">${c.location || "Location TBD"}</div>
      </td>
      <td style="vertical-align:top;text-align:right;white-space:nowrap;font-size:11px;color:#bbb;padding-left:10px">${timeAgo(c.posted_at)}</td>
    </tr>
  </table>
  <div style="margin:10px 0 12px">${typeTag}${unionTag}${paidTag}</div>
  ${synopsis}
  ${rolesHtml}
  <a href="${APP_URL}/castings/${c.slug}"
     style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:700;font-size:13px;letter-spacing:0.1px">
    View Casting →
  </a>
</div>`;
}

function buildDigestEmail(
  firstName: string,
  castings: CastingCard[],
  userId: string,
  totalMatches: number,
): string {
  const count = castings.length;
  const headline = count === 1 ? "1 new casting match for you" : `${count} new casting matches for you`;
  const cardsHtml = castings.map(castingCard).join("");
  const unsubUrl = `${UNSUB_BASE}?action=unsubscribe&uid=${userId}`;
  const prefsUrl = `${APP_URL}/account-settings`;
  const browseUrl = `${APP_URL}/castings`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${headline} — CastSlate</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f5f7;padding:40px 16px">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:18px;overflow:hidden;max-width:580px;width:100%;box-shadow:0 2px 20px rgba(0,0,0,0.06)">

        <!-- ── Header ── -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a0533 0%,#2d1052 100%);padding:26px 32px">
            <table cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding-right:12px;vertical-align:middle">
                  <div style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:9px;display:flex;align-items:center;justify-content:center">
                    <!--[if !mso]><!-->
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20" style="display:block"><path d="M4,16 L12,9 L12,12 L20,12 L20,9 L28,16 L20,23 L20,20 L12,20 L12,23 Z" fill="white"/></svg>
                    <!--<![endif]-->
                  </div>
                </td>
                <td style="vertical-align:middle">
                  <span style="font-size:19px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">CastSlate</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── Headline ── -->
        <tr>
          <td style="padding:30px 32px 18px">
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#111111;letter-spacing:-0.5px;line-height:1.25">${headline}</h1>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#666666">
              Hi ${firstName} — these projects match your profile and casting preferences.
              Review and submit while the roles are still open.
            </p>
          </td>
        </tr>

        <!-- ── Casting cards ── -->
        <tr>
          <td style="padding:0 20px 4px">
            ${cardsHtml}
          </td>
        </tr>

        <!-- ── Browse CTA ── -->
        <tr>
          <td style="padding:12px 32px 30px;text-align:center">
            <a href="${browseUrl}"
               style="display:inline-block;border:2px solid #6b3ecb;color:#6b3ecb;text-decoration:none;padding:12px 30px;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.1px">
              Browse All Castings
            </a>
          </td>
        </tr>

        <!-- ── Divider ── -->
        <tr><td style="padding:0 32px"><div style="height:1px;background:#f0f0f0"></div></td></tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="padding:22px 32px 28px">
            <p style="margin:0 0 6px;font-size:12px;color:#aaaaaa;line-height:1.7">
              You're receiving this because you signed up for CastSlate casting recommendations.<br/>
              <a href="${prefsUrl}" style="color:#8b5cf6;text-decoration:none">Manage preferences</a>
              &nbsp;·&nbsp;
              <a href="${unsubUrl}" style="color:#8b5cf6;text-decoration:none">Unsubscribe</a>
            </p>
            <p style="margin:0;font-size:11px;color:#cccccc">
              CastSlate · hello@castslate.com
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json() as {
      user_id?: string;
      to_email?: string;
      castings: CastingCard[];
      is_test?: boolean;
    };

    const { user_id, to_email, castings, is_test } = body;

    if (!castings?.length) {
      return json({ error: "No castings provided" }, 400);
    }
    if (!RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY not configured" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let recipientEmail = to_email ?? null;
    let firstName = "there";

    if (user_id && !is_test) {
      const { data: authData } = await supabase.auth.admin.getUserById(user_id);
      if (!authData?.user?.email) {
        return json({ error: "User not found or has no email address" }, 404);
      }
      recipientEmail = authData.user.email;

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user_id)
        .maybeSingle();
      firstName = (profile?.display_name ?? "").split(" ")[0].trim() || "there";
    }

    if (!recipientEmail) {
      return json({ error: "No recipient email address" }, 400);
    }

    const count = castings.length;
    const subject = count === 1
      ? "1 new casting match on CastSlate"
      : `${count} new casting matches on CastSlate`;

    const html = buildDigestEmail(firstName, castings, user_id ?? "test", count);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [recipientEmail], subject, html }),
    });

    let providerId: string | null = null;
    let emailStatus = "failed";
    let errorMsg: string | null = null;

    if (resendRes.ok) {
      const resData = await resendRes.json() as { id?: string };
      providerId = resData.id ?? null;
      emailStatus = "sent";
    } else {
      const errText = await resendRes.text();
      console.error("[send-digest-email] Resend error:", errText);
      errorMsg = errText;
    }

    // Log + record history for real (non-test) sends
    if (user_id && !is_test) {
      await supabase.from("email_digest_logs").insert({
        user_id,
        project_ids_included: castings.map(c => c.id),
        status: emailStatus,
        provider_message_id: providerId,
        error_message: errorMsg,
      });

      if (emailStatus === "sent") {
        const historyRows = castings.map(c => ({ user_id, casting_id: c.id }));
        await supabase
          .from("user_casting_email_history")
          .upsert(historyRows, { onConflict: "user_id,casting_id", ignoreDuplicates: true });

        await supabase
          .from("email_preferences")
          .update({ last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("user_id", user_id);
      }
    }

    return json({ ok: emailStatus === "sent", status: emailStatus, provider_id: providerId, error: errorMsg });
  } catch (err) {
    console.error("[send-digest-email] Unexpected error:", err);
    return json({ error: String(err) }, 500);
  }
});

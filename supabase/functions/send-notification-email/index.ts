// send-notification-email — Supabase Edge Function
// Sends transactional notifications via Resend (email) and Twilio (SMS).
// Called fire-and-forget from the frontend after message sends.
//
// Required secrets (Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY        — Resend API key (resend.com — free tier available)
//   NOTIFY_FROM_EMAIL     — sender, e.g. "CastSlate <notifications@castslate.com>"
//                           (domain must be verified in Resend)
//   APP_URL               — public URL, e.g. "https://www.castslate.com"
//
// Optional SMS secrets (Twilio):
//   TWILIO_ACCOUNT_SID    — Twilio account SID
//   TWILIO_AUTH_TOKEN     — Twilio auth token
//   TWILIO_PHONE_NUMBER   — your Twilio number, e.g. "+15005550006"
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/, "");
const TWILIO_SID           = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN         = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM          = Deno.env.get("TWILIO_PHONE_NUMBER");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotifyRequest {
  to_user_id: string;
  type: "inbox_message" | "class_invitation";
  from_id?: string;
  from_name?: string;
  application_id?: string;
  casting_id?: string;
  class_title?: string;
}

// Minimal HTML escape for any user-controlled string interpolated into the email.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inboxMessageHtml(firstName: string, fromName?: string, projectName?: string): string {
  const about = projectName ? ` about <strong>${esc(projectName)}</strong>` : "";
  const senderLine = fromName
    ? `You received a new message from <strong>${esc(fromName)}</strong>${about} on CastSlate.`
    : `You received a new message${about} on CastSlate.`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="background:linear-gradient(135deg,#1a0533,#2d1052);padding:28px 32px">
          <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CastSlate</div>
        </td></tr>
        <tr><td style="padding:36px 32px 28px">
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">New message on CastSlate</h1>
          <p style="margin:0 0 8px;font-size:16px;line-height:1.6;color:#555">
            Hi ${firstName},
          </p>
          <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#555">
            ${senderLine} Log in to your inbox to read and reply.
          </p>
          <a href="${APP_URL}/inbox"
             style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.1px">
            Open Inbox →
          </a>
        </td></tr>
        <tr><td style="padding:20px 32px 32px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
            You're receiving this because you have an account on CastSlate.<br/>
            To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#8b5cf6;text-decoration:none">Account Settings → Notifications</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function classInvitationHtml(firstName: string, classTitle: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="background:linear-gradient(135deg,#1a3d38,#254f49);padding:28px 32px">
          <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CastSlate</div>
        </td></tr>
        <tr><td style="padding:36px 32px 28px">
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">A class was selected for you</h1>
          <p style="margin:0 0 8px;font-size:16px;line-height:1.6;color:#555">
            Hi ${firstName}, CastSlate selected a class that may be a strong fit for your profile:
          </p>
          <p style="margin:0 0 28px;font-size:17px;font-weight:700;color:#1a3d38;line-height:1.4">
            ${classTitle}
          </p>
          <a href="${APP_URL}/talent-dashboard"
             style="display:inline-block;background:linear-gradient(90deg,#1a3d38,#254f49);color:#f0f8f6;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.1px">
            Go to Dashboard →
          </a>
        </td></tr>
        <tr><td style="padding:20px 32px 32px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
            You're receiving this because you have an account on CastSlate.<br/>
            To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#6b3ecb;text-decoration:none">Account Settings → Notifications</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendSms(toPhone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return { ok: false, error: "SMS_NOT_CONFIGURED" };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: TWILIO_FROM, To: toPhone, Body: body }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("[send-notification-email] Twilio error:", detail);
    return { ok: false, error: detail };
  }
  return { ok: true };
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
    const { to_user_id, type, from_id, from_name: rawFromName, application_id, casting_id, class_title } = (await req.json()) as NotifyRequest;

    if (!to_user_id || !type) {
      return json({ error: "Missing to_user_id or type" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load recipient profile: display_name, notification prefs, phone
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("display_name, notification_email, notification_messages, notification_marketing, notification_sms, phone")
      .eq("id", to_user_id)
      .maybeSingle();

    if (profileErr || !profile) {
      return json({ error: "User profile not found" }, 404);
    }

    // Resolve the related casting (for the project name + casting-aware sender
    // name). Prefer the application's casting, fall back to an explicit casting_id.
    let casting:
      | { title: string | null; prod: string | null; is_admin_created: boolean | null; cd_id: string | null }
      | null = null;
    if (type === "inbox_message") {
      if (application_id) {
        const { data } = await supabase
          .from("applications")
          .select("castings(title, prod, is_admin_created, cd_id)")
          .eq("id", application_id)
          .maybeSingle();
        // deno-lint-ignore no-explicit-any
        casting = ((data as any)?.castings) ?? null;
      }
      if (!casting && casting_id) {
        const { data } = await supabase
          .from("castings")
          .select("title, prod, is_admin_created, cd_id")
          .eq("id", casting_id)
          .maybeSingle();
        casting = data ?? null;
      }
    }
    const projectName = casting?.title?.trim() || undefined;

    // Resolve sender display name: prefer explicit from_name, then derive from the
    // casting + sender. Mirrors the client posterDisplayName rule: an admin-generated
    // casting surfaces the Production Company (prod) instead of the platform/admin
    // account name; a real CD surfaces their own name.
    let resolvedFromName = rawFromName?.trim() || undefined;
    if (!resolvedFromName && from_id) {
      const { data: senderProfile } = await supabase
        .from("profiles")
        .select("display_name, company_name, user_type")
        .eq("id", from_id)
        .maybeSingle();
      const senderType = (senderProfile?.user_type || "").toLowerCase();
      if (casting?.is_admin_created && (senderType === "admin" || senderType === "super_admin")) {
        const prod = (casting.prod || "").trim();
        resolvedFromName = prod && !/castslate/i.test(prod) ? prod : "Casting Director";
      } else if (senderProfile) {
        resolvedFromName = (senderProfile.display_name || senderProfile.company_name || "").trim() || undefined;
      }
    }

    const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
    const results: Record<string, unknown> = {};

    // ── Email notification ──────────────────────────────────────────────────
    const emailMasterEnabled = profile.notification_email !== false;
    const messageEmailEnabled = type === "inbox_message"
      ? emailMasterEnabled && profile.notification_messages !== false
      : emailMasterEnabled;

    if (messageEmailEnabled) {
      if (!RESEND_API_KEY) {
        console.warn("[send-notification-email] RESEND_API_KEY not set — skipping email");
        results.email = "skipped:EMAIL_NOT_CONFIGURED";
      } else {
        const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
        if (authErr || !authData?.user?.email) {
          results.email = "error:could_not_retrieve_user_email";
        } else {
          const toEmail = authData.user.email;
          const subject = type === "inbox_message"
            ? "New message on CastSlate"
            : "CastSlate selected a class for you";
          const html = type === "inbox_message"
            ? inboxMessageHtml(firstName, resolvedFromName, projectName)
            : classInvitationHtml(firstName, class_title?.trim() || "a class");

          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ from: FROM_EMAIL, to: [toEmail], subject, html }),
          });

          if (!resendRes.ok) {
            const detail = await resendRes.text();
            console.error("[send-notification-email] Resend error:", detail);
            results.email = `error:${detail}`;
          } else {
            results.email = "sent";
          }
        }
      }
    } else {
      results.email = "skipped:notifications_disabled_by_user";
    }

    // ── SMS notification ────────────────────────────────────────────────────
    const smsEnabled = profile.notification_sms === true;
    const rawPhone = (profile.phone ?? "").trim();
    const validPhone = /^\+?[1-9]\d{7,14}$/.test(rawPhone.replace(/[\s\-().]/g, ""));

    if (smsEnabled && validPhone && type === "inbox_message") {
      const normalizedPhone = rawPhone.startsWith("+") ? rawPhone : `+1${rawPhone.replace(/\D/g, "")}`;
      const smsBody = `CastSlate: You received a new message${resolvedFromName ? ` from ${resolvedFromName}` : ""}${projectName ? ` about ${projectName}` : ""}. Open your inbox: ${APP_URL}/inbox`;
      const smsResult = await sendSms(normalizedPhone, smsBody);
      results.sms = smsResult.ok ? "sent" : `error:${smsResult.error}`;
    } else if (smsEnabled && !validPhone && type === "inbox_message") {
      results.sms = "skipped:invalid_or_missing_phone";
    } else {
      results.sms = "skipped:sms_not_enabled";
    }

    return json({ ok: true, results });
  } catch (err) {
    console.error("[send-notification-email] Unexpected error:", err);
    return json({ error: String(err) }, 500);
  }
});

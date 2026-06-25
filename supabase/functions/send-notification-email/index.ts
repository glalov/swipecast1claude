// send-notification-email — Supabase Edge Function
// Sends transactional notifications via email (Resend or Amazon SES) and Twilio (SMS).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/, "");
const TWILIO_SID           = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN         = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM          = Deno.env.get("TWILIO_PHONE_NUMBER");

// Email provider abstraction. Defaults to Resend; set EMAIL_PROVIDER="ses" to
// route every send through Amazon SES (v2 API, SigV4-signed). Resend stays as fallback.
const EMAIL_PROVIDER        = (Deno.env.get("EMAIL_PROVIDER") ?? "resend").toLowerCase();
const AWS_ACCESS_KEY_ID     = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const AWS_SES_REGION        = Deno.env.get("AWS_SES_REGION") ?? Deno.env.get("AWS_REGION") ?? "us-east-1";

function emailConfigured(): boolean {
  return EMAIL_PROVIDER === "ses"
    ? !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY)
    : !!RESEND_API_KEY;
}

interface SendEmailArgs { from:string; to:string[]; subject:string; html:string; text?:string; replyTo?:string; headers?:Record<string,string>; }
interface SendEmailResult { ok:boolean; id:string|null; err:string|null; status:number; }

async function sendEmail(a: SendEmailArgs): Promise<SendEmailResult> {
  if (EMAIL_PROVIDER === "ses") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY)
      return { ok:false, id:null, err:"AWS SES credentials not set", status:500 };
    try {
      const { AwsClient } = await import("https://esm.sh/aws4fetch@1.0.20");
      const aws = new AwsClient({ accessKeyId:AWS_ACCESS_KEY_ID, secretAccessKey:AWS_SECRET_ACCESS_KEY, region:AWS_SES_REGION, service:"ses" });
      // deno-lint-ignore no-explicit-any
      const content:any = { Simple:{ Subject:{ Data:a.subject, Charset:"UTF-8" }, Body:{ Html:{ Data:a.html, Charset:"UTF-8" } } } };
      if (a.text) content.Simple.Body.Text = { Data:a.text, Charset:"UTF-8" };
      if (a.headers) content.Simple.Headers = Object.entries(a.headers).map(([Name,Value])=>({ Name, Value }));
      // deno-lint-ignore no-explicit-any
      const payload:any = { FromEmailAddress:a.from, Destination:{ ToAddresses:a.to }, Content:content };
      if (a.replyTo) payload.ReplyToAddresses = [a.replyTo];
      const r = await aws.fetch(`https://email.${AWS_SES_REGION}.amazonaws.com/v2/email/outbound-emails`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(payload),
      });
      if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.MessageId ?? null, err:null, status:r.status }; }
      return { ok:false, id:null, err:await r.text(), status:r.status };
    } catch (e) { return { ok:false, id:null, err:String(e), status:500 }; }
  }
  if (!RESEND_API_KEY) return { ok:false, id:null, err:"RESEND_API_KEY not set", status:500 };
  // deno-lint-ignore no-explicit-any
  const body:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
  if (a.text) body.text = a.text;
  if (a.replyTo) body.reply_to = a.replyTo;
  if (a.headers) body.headers = a.headers;
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(body),
  });
  if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.id ?? null, err:null, status:r.status }; }
  return { ok:false, id:null, err:await r.text(), status:r.status };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotifyRequest {
  to_user_id: string;
  type: "inbox_message" | "class_invitation" | "booking_approved" | "booking_declined";
  from_id?: string;
  from_name?: string;
  application_id?: string;
  casting_id?: string;
  class_title?: string;
  // booking_* extras
  slot_label?: string;
  admin_note?: string;
  class_price?: string;
  class_id?: string;
}

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

function bookingApprovedHtml(firstName: string, classTitle: string, slotLabel?: string, classPrice?: string, classId?: string): string {
  const slotLine = slotLabel
    ? `<p style="margin:0 0 4px;font-size:14px;color:#555">Session: <strong>${esc(slotLabel)}</strong></p>`
    : "";
  const priceLine = classPrice
    ? `<p style="margin:0 0 24px;font-size:14px;color:#555">Price: <strong>${esc(classPrice)}</strong></p>`
    : `<p style="margin:0 0 24px"></p>`;
  // Deep-link straight to the class so the "Complete Payment" banner is right there.
  const payUrl = classId ? `${APP_URL}/classes?class=${encodeURIComponent(classId)}` : `${APP_URL}/classes`;
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
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">You're approved — complete your booking</h1>
          <p style="margin:0 0 8px;font-size:16px;line-height:1.6;color:#555">
            Hi ${firstName}, good news — your booking request was approved for:
          </p>
          <p style="margin:0 0 12px;font-size:17px;font-weight:700;color:#2d1052;line-height:1.4">
            ${classTitle}
          </p>
          ${slotLine}
          ${priceLine}
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#555">
            Your spot is reserved for <strong>48 hours</strong>. Complete payment now to lock it in.
          </p>
          <a href="${payUrl}"
             style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.1px">
            Complete Payment →
          </a>
        </td></tr>
        <tr><td style="padding:20px 32px 32px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
            You're receiving this because you requested a class booking on CastSlate.<br/>
            To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#8b5cf6;text-decoration:none">Account Settings → Notifications</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function bookingDeclinedHtml(firstName: string, classTitle: string, adminNote?: string): string {
  const noteLine = adminNote
    ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#555">${esc(adminNote)}</p>`
    : "";
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
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">Update on your class booking request</h1>
          <p style="margin:0 0 8px;font-size:16px;line-height:1.6;color:#555">
            Hi ${firstName}, thanks for your interest in:
          </p>
          <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#2d1052;line-height:1.4">
            ${classTitle}
          </p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#555">
            Unfortunately your request wasn't approved at this time.
          </p>
          ${noteLine}
          <a href="${APP_URL}/classes"
             style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.1px">
            Browse Classes →
          </a>
        </td></tr>
        <tr><td style="padding:20px 32px 32px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
            You're receiving this because you requested a class booking on CastSlate.<br/>
            To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#8b5cf6;text-decoration:none">Account Settings → Notifications</a>.
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
    const { to_user_id, type, from_id, from_name: rawFromName, application_id, casting_id, class_title, slot_label, admin_note, class_price, class_id } = (await req.json()) as NotifyRequest;

    if (!to_user_id || !type) {
      return json({ error: "Missing to_user_id or type" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("display_name, notification_email, notification_messages, notification_marketing, notification_sms, phone")
      .eq("id", to_user_id)
      .maybeSingle();

    if (profileErr || !profile) {
      return json({ error: "User profile not found" }, 404);
    }

    // ── Booking lifecycle notifications (approved / declined) ──────────────
    // Transactional & payment-critical: respect only the master email toggle,
    // not the per-message preference. This is what tells talent to go pay.
    if (type === "booking_approved" || type === "booking_declined") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailMasterEnabled = profile.notification_email !== false;

      if (!emailMasterEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping booking email");
        return json({ ok: true, results: { email: "skipped:EMAIL_NOT_CONFIGURED" } });
      }

      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
      if (authErr || !authData?.user?.email) {
        return json({ ok: false, results: { email: "error:could_not_retrieve_user_email" } });
      }
      const toEmail = authData.user.email;
      const ct = class_title?.trim() || "your class";
      const subject = type === "booking_approved"
        ? "You're approved — complete your CastSlate booking"
        : "Update on your CastSlate class booking";
      const html = type === "booking_approved"
        ? bookingApprovedHtml(firstName, ct, slot_label?.trim() || undefined, class_price?.trim() || undefined, class_id?.trim() || undefined)
        : bookingDeclinedHtml(firstName, ct, admin_note?.trim() || undefined);

      const sent = await sendEmail({ from: FROM_EMAIL, to: [toEmail], replyTo: CONTACT_EMAIL, subject, html });
      if (!sent.ok) {
        console.error("[send-notification-email] booking send error:", sent.err);
        return json({ ok: false, results: { email: `error:${sent.err}` } });
      }
      return json({ ok: true, results: { email: "sent" } });
    }

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

    const emailMasterEnabled = profile.notification_email !== false;
    const messageEmailEnabled = type === "inbox_message"
      ? emailMasterEnabled && profile.notification_messages !== false
      : emailMasterEnabled;

    if (messageEmailEnabled) {
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping email");
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

          const sent = await sendEmail({ from: FROM_EMAIL, to: [toEmail], replyTo: CONTACT_EMAIL, subject, html });

          if (!sent.ok) {
            console.error("[send-notification-email] send error:", sent.err);
            results.email = `error:${sent.err}`;
          } else {
            results.email = "sent";
          }
        }
      }
    } else {
      results.email = "skipped:notifications_disabled_by_user";
    }

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

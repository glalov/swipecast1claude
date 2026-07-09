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
  type: "inbox_message" | "class_invitation" | "booking_approved" | "booking_declined" | "premium_welcome" | "new_actor_welcome" | "weekly_checkin" | "application_selected" | "activity_digest";
  from_id?: string;
  from_name?: string;
  application_id?: string;
  casting_id?: string;
  class_title?: string;
  instructor_name?: string;
  // booking_* extras
  slot_label?: string;
  admin_note?: string;
  class_price?: string;
  class_id?: string;
  // weekly_checkin extra — this week's task (the email hook)
  task?: string;
  // application_selected extras (the "you've been shortlisted" email)
  project_name?: string;
  role_name?: string;
  cd_name?: string;
  // activity_digest extras (the daily "you're getting noticed" recap)
  profile_views?: number;
  tape_views?: number;
  shortlists?: number;
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

function classInvitationHtml(firstName: string, classTitle: string, instructorName?: string): string {
  const withLine = instructorName
    ? `<p style="margin:0 0 6px;font-size:15px;color:#555">with <strong style="color:#0f4d34">${esc(instructorName)}</strong></p>`
    : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%">
        <tr><td style="background:linear-gradient(135deg,#0f4d34,#1a6b42);padding:20px 36px">
          <img src="https://www.castslate.com/logo-email.png" alt="CastSlate" width="38" height="38" style="display:inline-block;vertical-align:middle;border-radius:9px"/>
          <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:21px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CastSlate</span>
          <div style="margin-top:12px;display:inline-block;background:rgba(255,255,255,0.16);color:#d7f0e2;font-size:12px;font-weight:700;letter-spacing:0.4px;padding:4px 12px;border-radius:20px;text-transform:uppercase">Private Invitation</div>
        </td></tr>
        <tr><td style="padding:32px 36px 28px">
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">You've been selected for a private invitation, ${firstName}</h1>
          <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:#555">
            Our team at CastSlate reviewed your profile and selected you for a private invitation to train one-on-one with a top industry professional. This is not a public class or mass mailing — spots are limited and offered only to selected actors.
          </p>
          <div style="margin:0 0 22px;padding:18px 20px;background:#eef7f1;border:1px solid #cfe9da;border-radius:12px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#1a6b42;margin:0 0 6px">Private Invitation</div>
            <p style="margin:0 0 4px;font-size:18px;font-weight:800;color:#0f4d34;line-height:1.35">${classTitle}</p>
            ${withLine}
          </div>
          <p style="margin:0 0 26px;font-size:15px;line-height:1.65;color:#555">
            Log in to your CastSlate Dashboard to view your invitation, choose an available time, and request your spot.
          </p>
          <a href="${APP_URL}/talent-dashboard"
             style="display:inline-block;background:linear-gradient(90deg,#1a6b42,#1e8050);color:#fff;text-decoration:none;padding:15px 38px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">
            View My Invitation →
          </a>
        </td></tr>
        <tr><td style="padding:20px 36px 32px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
            You're receiving this because a class invitation was sent to your CastSlate account.<br/>
            To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#1a6b42;text-decoration:none">Account Settings → Notifications</a>.
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

function weeklyCheckinHtml(firstName: string, task?: string): string {
  const taskBlock = task
    ? `<div style="margin:0 0 24px;padding:16px 18px;background:#f4f1fb;border:1px solid #e2daf5;border-radius:12px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b3ecb;margin:0 0 6px">This week's task</div><p style="margin:0;font-size:15px;line-height:1.6;color:#2d1052;font-weight:500">${esc(task)}</p></div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:560px;width:100%"><tr><td style="background:#1a0533;padding:22px 32px"><img src="https://www.castslate.com/logo-email.png" alt="CastSlate" width="38" height="38" style="display:inline-block;vertical-align:middle;border-radius:9px"/><span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:21px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CastSlate</span><div style="margin-top:12px;display:inline-block;background:rgba(139,92,246,0.25);color:#d7c4ff;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:4px 12px;border-radius:20px;text-transform:uppercase">Manager Mode &middot; Weekly check-in</div></td></tr><tr><td style="padding:32px 32px 12px"><h1 style="margin:0 0 14px;font-size:23px;font-weight:800;color:#111;letter-spacing:-0.5px">Your weekly career note is ready, ${firstName}</h1><p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:#555">Your personalized Manager Mode check-in for this week is waiting in your CastSlate inbox — one focused step to keep your profile moving and keep you castable.</p>${taskBlock}<a href="${APP_URL}/inbox" style="display:inline-block;background:#6b3ecb;color:#fff;text-decoration:none;padding:14px 34px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.1px">Open my note &rarr;</a><p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#888">Your full note includes what you're doing well, your casting lane, and this week's focus — open it in the app to read it and mark your task done.</p></td></tr><tr><td style="padding:20px 32px 28px;border-top:1px solid #f0f0f0"><p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">You're receiving this because you're a CastSlate Premium member with Manager Mode.<br/>To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#8b5cf6;text-decoration:none">Account Settings &rarr; Notifications</a>.</p></td></tr></table></td></tr></table></body></html>`;
}

function premiumWelcomeHtml(firstName: string): string {
  const row = (title: string, body: string) =>
    `<tr><td style="padding:0 0 18px"><div style="font-size:15px;font-weight:700;color:#2d1052;margin:0 0 2px">${title}</div><div style="font-size:14px;line-height:1.6;color:#555;margin:0">${body}</div></td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%">
      <tr><td style="background:linear-gradient(135deg,#1a0533,#2d1052);padding:30px 36px">
        <img src="https://www.castslate.com/logo-email.png" alt="CastSlate" width="40" height="40" style="display:inline-block;vertical-align:middle;border-radius:9px"/>
        <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:21px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CastSlate</span>
        <div style="margin-top:14px;display:inline-block;background:rgba(139,92,246,0.25);color:#d7c4ff;font-size:12px;font-weight:700;letter-spacing:0.4px;padding:4px 12px;border-radius:20px;text-transform:uppercase">Premium</div>
      </td></tr>
      <tr><td style="padding:36px 36px 8px">
        <h1 style="margin:0 0 14px;font-size:25px;font-weight:800;color:#111;letter-spacing:-0.5px">Welcome to CastSlate Premium, ${firstName} 🎬</h1>
        <p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:#555">You're all set. Premium unlocks everything you need to get seen — and the more complete your profile, the more castable you become.</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#555">Here's how to get the most out of it:</p>
      </td></tr>
      <tr><td style="padding:0 36px 8px">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${row("📅 Manager Mode — your weekly check-in", "Every week (usually Monday–Wednesday) you'll get one focused task to improve your profile and stay castable. Keep an eye out for it at the start of the week — small steps each week add up fast.")}
          ${row("📸 Upload everything you can", "Add as many photos and headshots as possible, fill out <strong>all</strong> your stats, and record your <strong>'Cast Me As'</strong> videos and your <strong>7-second Actor's Slate</strong>. A full profile is what makes casting directors stop and look.")}
          ${row("🎞️ Unlimited storage", "Upload demo reels, video clips, and photos with no limits — build the most complete picture of your range.")}
          ${row("💬 Message casting directors", "Send video messages directly to CDs, right from the platform.")}
          ${row("🪪 Your Actor Business Card + QR code", "Everything above becomes viewable anywhere, by any industry professional, in seconds — your card's QR code opens your full profile, reels, slate, and stats right in front of them.")}
        </table>
      </td></tr>
      <tr><td style="padding:14px 36px 36px" align="center">
        <a href="${APP_URL}/talent-dashboard" style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:15px 38px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">Complete Your Profile →</a>
      </td></tr>
      <tr><td style="padding:20px 36px 32px;border-top:1px solid #f0f0f0">
        <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">You're receiving this because you upgraded to CastSlate Premium.<br/>To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#8b5cf6;text-decoration:none">Account Settings → Notifications</a>.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function newActorWelcomeHtml(firstName: string): string {
  const step = (emoji: string, title: string, body: string) =>
    `<tr><td style="background:#f1f7f7;border:1px solid #d9e9e9;border-radius:12px;padding:16px 18px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="34" valign="top" style="font-size:20px;line-height:1">${emoji}</td>
        <td valign="top">
          <div style="font-size:15px;font-weight:800;color:#1A1A2E;margin:0 0 3px">${title}</div>
          <div style="font-size:14px;line-height:1.6;color:#555">${body}</div>
        </td>
      </tr></table>
    </td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f6;padding:40px 20px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%">

      <tr><td style="background:#4F8A8B;background:linear-gradient(135deg,#2f5f60 0%,#4F8A8B 55%,#5fa0a1 100%);border-top:3px solid #6fb0b1;padding:34px 36px 32px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="width:52px">
            <span style="display:inline-block;background:#ffffff;border-radius:12px;padding:9px;line-height:0;box-shadow:0 4px 14px rgba(0,0,0,0.20)">
              <img src="${APP_URL}/logo-email.png" alt="CastSlate" width="30" height="30" style="display:block"/>
            </span>
          </td>
          <td valign="middle" style="padding-left:14px">
            <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1">CastSlate</div>
            <div style="margin-top:4px;font-size:11px;font-weight:600;color:#dff1f1;letter-spacing:2px;text-transform:uppercase">Get seen. Get cast.</div>
          </td>
          <td valign="middle" align="right">
            <span style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.28);color:#f2fbfb;font-size:11px;font-weight:700;letter-spacing:0.5px;padding:5px 13px;border-radius:20px;text-transform:uppercase">Get started</span>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="padding:36px 36px 8px">
        <h1 style="margin:0 0 14px;font-size:25px;font-weight:800;color:#1A1A2E;letter-spacing:-0.5px">Welcome to CastSlate, ${firstName} 🎬</h1>
        <p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:#555">Your account is live. You're about <strong>two minutes</strong> from being ready to apply to real castings — here's all it takes.</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#555">Follow these three steps in order:</p>
      </td></tr>

      <tr><td style="padding:0 36px 8px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px">
          ${step("📸", `1 &middot; Add your headshot <span style="font-weight:700;color:#37696A">(required to apply)</span>`, "This is the one thing you need before you can submit to a casting. A clean, well-lit photo — even from your phone — works. You can add more later.")}
          ${step("✍️", "2 &middot; Fill in your basics", "Add your stats and a short bio so a casting director knows who they're looking at the moment they open your profile.")}
          ${step("🎬", "3 &middot; Browse castings &amp; send your first submission", "Free accounts can submit to <strong>one casting a week</strong>. Find a role that fits and apply — every submission is reviewed by the casting director individually.")}
        </table>
      </td></tr>

      <tr><td style="padding:18px 36px 26px" align="center">
        <a href="${APP_URL}/my-profile" style="display:inline-block;background:linear-gradient(90deg,#4F8A8B,#37696A);color:#fff;text-decoration:none;padding:15px 40px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">Add my headshot →</a>
      </td></tr>

      <tr><td style="padding:0 36px 30px">
        <div style="background:#f4f9f9;border:1px dashed #bfdcdc;border-radius:12px;padding:16px 18px">
          <div style="font-size:13px;font-weight:800;color:#1A1A2E;margin:0 0 4px">Want to move faster?</div>
          <div style="font-size:13.5px;line-height:1.6;color:#555">Premium ($9.99/mo) unlocks <strong>unlimited submissions</strong>, unlimited photos &amp; videos, your Actor's Slate, and an Actor Business Card with a QR code. Start free — upgrade whenever you're ready.</div>
        </div>
      </td></tr>

      <tr><td style="padding:20px 36px 32px;border-top:1px solid #f0f0f0">
        <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">You're receiving this because you created a CastSlate account.<br/>To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#4F8A8B;text-decoration:none">Account Settings → Notifications</a>.</p>
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;
}

function applicationSelectedHtml(firstName: string, projectName?: string, roleName?: string, cdName?: string): string {
  const forRole = roleName ? ` for <strong>${esc(roleName)}</strong>` : "";
  const reviewer = cdName ? `<strong>${esc(cdName)}</strong>` : "A casting director";
  const onProject = projectName
    ? `<div style="margin:0 0 22px;padding:18px 20px;background:#f4f1fb;border:1px solid #e2daf5;border-radius:12px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b3ecb;margin:0 0 6px">Shortlisted</div><p style="margin:0;font-size:18px;font-weight:800;color:#2d1052;line-height:1.35">${esc(projectName)}${roleName ? ` &middot; ${esc(roleName)}` : ""}</p></div>`
    : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="background:linear-gradient(135deg,#1a0533,#2d1052);padding:22px 32px">
          <img src="https://www.castslate.com/logo-email.png" alt="CastSlate" width="38" height="38" style="display:inline-block;vertical-align:middle;border-radius:9px"/>
          <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:21px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CastSlate</span>
          <div style="margin-top:12px;display:inline-block;background:rgba(255,215,154,0.2);color:#ffd79a;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:4px 12px;border-radius:20px;text-transform:uppercase">Good news</div>
        </td></tr>
        <tr><td style="padding:34px 32px 12px">
          <h1 style="margin:0 0 14px;font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">You've been shortlisted, ${firstName}</h1>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:#555">
            ${reviewer} just shortlisted you${forRole} on CastSlate. That means your submission stood out and you're on their short list to move forward.
          </p>
          ${onProject}
          <p style="margin:0 0 26px;font-size:15px;line-height:1.65;color:#555">
            Keep your profile sharp — a complete profile, fresh headshots and an up-to-date slate are what turn a shortlist into a callback. If the casting director wants to move forward, you'll hear from them right here in your inbox.
          </p>
          <a href="${APP_URL}/talent-dashboard"
             style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:14px 34px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">
            View My Applications →
          </a>
        </td></tr>
        <tr><td style="padding:20px 32px 32px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">
            You're receiving this because a casting director took action on one of your CastSlate submissions.<br/>
            To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#8b5cf6;text-decoration:none">Account Settings → Notifications</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function activityDigestHtml(firstName: string, profileViews: number, tapeViews: number, shortlists: number): string {
  const row = (icon: string, text: string) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><span style="display:inline-block;width:26px;font-size:18px;vertical-align:middle">${icon}</span><span style="font-size:16px;color:#2d1052;font-weight:600;vertical-align:middle">${text}</span></td></tr>`;
  const rows = [
    shortlists > 0 ? row("&#11088;", `${shortlists} casting ${shortlists === 1 ? "director" : "directors"} shortlisted you`) : "",
    profileViews > 0 ? row("&#128065;&#65039;", `${profileViews} casting ${profileViews === 1 ? "director" : "directors"} viewed your profile`) : "",
    tapeViews > 0 ? row("&#127916;", `${tapeViews} watched your audition ${tapeViews === 1 ? "reel" : "reels"}`) : "",
  ].join("");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="background:linear-gradient(135deg,#1a0533,#2d1052);padding:22px 32px">
          <img src="https://www.castslate.com/logo-email.png" alt="CastSlate" width="38" height="38" style="display:inline-block;vertical-align:middle;border-radius:9px"/>
          <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:21px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">CastSlate</span>
        </td></tr>
        <tr><td style="padding:34px 32px 10px">
          <h1 style="margin:0 0 14px;font-size:24px;font-weight:800;color:#111;letter-spacing:-0.5px">You're getting noticed, ${firstName} &#11088;</h1>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.65;color:#555">Here's the attention your work drew on CastSlate in the last day:</p>
        </td></tr>
        <tr><td style="padding:0 32px 8px">
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>
        <tr><td style="padding:22px 32px 30px">
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#777">Every one of these is a casting director engaging with your submission &mdash; keep your headshots, r&eacute;sum&eacute;, and reel sharp to turn attention into callbacks.</p>
          <a href="${APP_URL}/talent-dashboard" style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:14px 34px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">View my dashboard &rarr;</a>
        </td></tr>
        <tr><td style="padding:20px 32px 32px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6">You're receiving this because casting directors engaged with your CastSlate submissions.<br/>To manage notifications, visit <a href="${APP_URL}/account-settings" style="color:#8b5cf6;text-decoration:none">Account Settings &rarr; Notifications</a>.</p>
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
    const { to_user_id, type, from_id, from_name: rawFromName, application_id, casting_id, class_title, instructor_name, slot_label, admin_note, class_price, class_id, task, project_name, role_name, cd_name, profile_views, tape_views, shortlists } = (await req.json()) as NotifyRequest;

    if (!to_user_id || !type) {
      return json({ error: "Missing to_user_id or type" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("display_name, notification_email, notification_messages, notification_applications, notification_marketing, notification_sms, phone")
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

    // ── Application shortlisted (fired when a CD selects/shortlists talent) ──
    // The one "loud" positive signal in the review flow. Respects the master
    // email toggle AND the per-type application preference. Passes (holds) and
    // rejections never reach this function — they stay silent by design.
    if (type === "application_selected") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailEnabled = profile.notification_email !== false && profile.notification_applications !== false;
      if (!emailEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping shortlist email");
        return json({ ok: true, results: { email: "skipped:EMAIL_NOT_CONFIGURED" } });
      }
      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
      if (authErr || !authData?.user?.email) {
        return json({ ok: false, results: { email: "error:could_not_retrieve_user_email" } });
      }
      const sent = await sendEmail({
        from: FROM_EMAIL, to: [authData.user.email], replyTo: CONTACT_EMAIL,
        subject: `${firstName}, you've been shortlisted on CastSlate`,
        html: applicationSelectedHtml(firstName, project_name?.trim() || undefined, role_name?.trim() || undefined, cd_name?.trim() || undefined),
      });
      if (!sent.ok) {
        console.error("[send-notification-email] shortlist send error:", sent.err);
        return json({ ok: false, results: { email: `error:${sent.err}` } });
      }
      return json({ ok: true, results: { email: "sent" } });
    }

    // ── Daily activity digest ("you're getting noticed") — one batched email
    //    per day recapping profile views / tape watches / shortlists. Gated on
    //    the applications preference so it honors the same opt-out as shortlists. ──
    if (type === "activity_digest") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailEnabled = profile.notification_email !== false && profile.notification_applications !== false;
      if (!emailEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      const pv = Math.max(0, Math.round(Number(profile_views) || 0));
      const tv = Math.max(0, Math.round(Number(tape_views) || 0));
      const sl = Math.max(0, Math.round(Number(shortlists) || 0));
      if (pv + tv + sl === 0) {
        return json({ ok: true, results: { email: "skipped:no_activity" } });
      }
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping activity digest");
        return json({ ok: true, results: { email: "skipped:EMAIL_NOT_CONFIGURED" } });
      }
      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
      if (authErr || !authData?.user?.email) {
        return json({ ok: false, results: { email: "error:could_not_retrieve_user_email" } });
      }
      const sent = await sendEmail({
        from: FROM_EMAIL, to: [authData.user.email], replyTo: CONTACT_EMAIL,
        subject: "You're getting noticed on CastSlate",
        html: activityDigestHtml(firstName, pv, tv, sl),
      });
      if (!sent.ok) {
        console.error("[send-notification-email] activity digest send error:", sent.err);
        return json({ ok: false, results: { email: `error:${sent.err}` } });
      }
      return json({ ok: true, results: { email: "sent" } });
    }

    // ── Premium welcome (fired once when a user pays for Premium) ──────────
    if (type === "premium_welcome") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailMasterEnabled = profile.notification_email !== false;
      if (!emailMasterEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping premium welcome");
        return json({ ok: true, results: { email: "skipped:EMAIL_NOT_CONFIGURED" } });
      }
      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
      if (authErr || !authData?.user?.email) {
        return json({ ok: false, results: { email: "error:could_not_retrieve_user_email" } });
      }
      const sent = await sendEmail({
        from: FROM_EMAIL, to: [authData.user.email], replyTo: CONTACT_EMAIL,
        subject: "Welcome to CastSlate Premium — here's how to get seen",
        html: premiumWelcomeHtml(firstName),
      });
      if (!sent.ok) {
        console.error("[send-notification-email] premium welcome send error:", sent.err);
        return json({ ok: false, results: { email: `error:${sent.err}` } });
      }
      return json({ ok: true, results: { email: "sent" } });
    }

    // ── New actor welcome (fired once when a talent confirms their signup) ──
    //    Onboarding nudge that drives them to upload a headshot and apply.
    if (type === "new_actor_welcome") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailMasterEnabled = profile.notification_email !== false;
      if (!emailMasterEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping new actor welcome");
        return json({ ok: true, results: { email: "skipped:EMAIL_NOT_CONFIGURED" } });
      }
      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
      if (authErr || !authData?.user?.email) {
        return json({ ok: false, results: { email: "error:could_not_retrieve_user_email" } });
      }
      const sent = await sendEmail({
        from: FROM_EMAIL, to: [authData.user.email], replyTo: CONTACT_EMAIL,
        subject: "Welcome to CastSlate — let's get you cast 🎬",
        html: newActorWelcomeHtml(firstName),
      });
      if (!sent.ok) {
        console.error("[send-notification-email] new actor welcome send error:", sent.err);
        return json({ ok: false, results: { email: `error:${sent.err}` } });
      }
      return json({ ok: true, results: { email: "sent" } });
    }

    // ── Weekly Manager Mode check-in nudge (premium-only; fired alongside the
    //    in-app note). Short email that drives the member back into the app. ──
    if (type === "weekly_checkin") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailMasterEnabled = profile.notification_email !== false;
      if (!emailMasterEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping weekly check-in");
        return json({ ok: true, results: { email: "skipped:EMAIL_NOT_CONFIGURED" } });
      }
      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
      if (authErr || !authData?.user?.email) {
        return json({ ok: false, results: { email: "error:could_not_retrieve_user_email" } });
      }
      const sent = await sendEmail({
        from: FROM_EMAIL, to: [authData.user.email], replyTo: CONTACT_EMAIL,
        subject: "Your weekly CastSlate career note is ready",
        html: weeklyCheckinHtml(firstName, task?.trim() || undefined),
      });
      if (!sent.ok) {
        console.error("[send-notification-email] weekly check-in send error:", sent.err);
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
            : `${firstName}, you've been personally invited — CastSlate`;
          const html = type === "inbox_message"
            ? inboxMessageHtml(firstName, resolvedFromName, projectName)
            : classInvitationHtml(firstName, class_title?.trim() || "a class", instructor_name?.trim() || undefined);

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

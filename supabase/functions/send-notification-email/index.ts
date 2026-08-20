// send-notification-email — Supabase Edge Function
// Sends transactional notifications via email (Resend or Amazon SES) and Twilio (SMS).
//
// ⚠ BEFORE DEPLOYING: diff this file against the DEPLOYED function first. Edits have been
// made directly to the live function without coming back here, and a blind deploy from the
// repo has already been one keystroke away from removing the authorization gate below and
// reverting the standardized #f0f4f4 surrounds. Fetch the live source, diff, reconcile.
//
// AUTHORIZATION: this endpoint used to accept anonymous POSTs, so anyone who knew the URL
// could send mail to any user id. Callers must now present one of: the shared
// notify_fn_secret (the database functions, via public.notify_fn_secret()), the service
// role key (weekly-checkin-run), or a signed-in user's JWT (the app itself). verify_jwt
// stays false because the DB callers are not JWT-bearing — the check below is the gate.
//
// PREMIUM MEMBERS RECEIVE EMAIL NORMALLY — inbox messages, shortlists, holds, class and
// event invitations, booking updates, activity recaps, and the premium welcome all send
// exactly as they do for free accounts. Exactly ONE type is withheld:
//   • 'weekly_checkin' — the Manager Mode weekly note lives in the member's inbox on the
//     site and is read there. Emailing it was what turned a quiet week into a
//     cancellation, so the note is delivered in-app and never mailed.
// The daily CASTING digest is also premium-free, but that is enforced elsewhere — in the
// get_digest_emails() RPC, which omits active members — not here.

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

// The only notification types withheld from a paying member. Everything not listed here
// reaches them exactly as it reaches a free account.
const PREMIUM_EMAIL_BLOCKED = new Set(["weekly_checkin"]);

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
  type: "inbox_message" | "class_invitation" | "booking_approved" | "booking_declined" | "premium_welcome" | "new_actor_welcome" | "weekly_checkin" | "application_selected" | "application_hold" | "activity_digest";
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

// ── Warm tonal email system ─────────────────────────────────────────────
// Cream "stationery" shell whose header/CTA/accent share one tone keyed to
// the emotion of the message: teal = trust, amber = chosen/reward, emerald =
// greenlit, stone = a soft no. A gold "foil" CTA is reserved for the two
// feel-special moments (a shortlist win and the Premium weekly note). This
// mirrors the approved "Warm Tonal" design demo 1:1.
type ToneName = "teal" | "amber" | "green" | "stone";
interface Tone { grad: string; solid: string; soft: string; rule: string; }
const TONES: Record<ToneName, Tone> = {
  teal:  { grad: "linear-gradient(150deg,#2f5b5c 0%,#4F8A8B 65%,#3a6c6d 100%)", solid: "#37696A", soft: "#EAF2F2", rule: "rgba(233,244,238,.5)" },
  amber: { grad: "linear-gradient(150deg,#A85F13 0%,#E0871F 70%,#b96c16 100%)", solid: "#B4711A", soft: "#FCF2E3", rule: "rgba(255,236,206,.55)" },
  green: { grad: "linear-gradient(150deg,#12502f 0%,#1B7A3B 68%,#155f31 100%)", solid: "#1B7A3B", soft: "#E7F4EC", rule: "linear-gradient(90deg,#E8B96A,rgba(232,185,106,0))" },
  stone: { grad: "linear-gradient(150deg,#544c42 0%,#6E655A 70%,#5a5249 100%)", solid: "#6E655A", soft: "#F1EEE7", rule: "rgba(240,236,228,.5)" },
};

// White rounded tile holding the CastSlate arrow mark — reads as the brand
// "cube" on any colored header, and survives clients that strip inline SVG.
function csLogo(): string {
  return `<span style="display:inline-block;background:#FBF8F1;border-radius:8px;padding:8px;line-height:0;vertical-align:middle;box-shadow:0 3px 10px rgba(0,0,0,0.18)"><img src="${APP_URL}/logo-email.png" alt="CastSlate" width="22" height="22" style="display:block"/></span>`;
}

// Tone-keyed detail card (session, shortlisted role, this week's task…).
function csBlock(tone: ToneName, kicker: string, title: string, sub?: string): string {
  const t = TONES[tone];
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 26px"><tr>
      <td style="background:${t.soft};border:1px solid ${t.solid}2b;border-left:3px solid ${t.solid};border-radius:10px;padding:18px 20px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${t.solid};margin:0 0 8px">${kicker}</div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1A1A2E;line-height:1.25">${title}</div>
        ${sub ? `<div style="font-size:14px;color:#5A5A72;margin-top:5px">${sub}</div>` : ""}
      </td></tr></table>`;
}

interface ShellArgs {
  tone: ToneName; tag: string; foil?: boolean; heading: string;
  greeting?: string; body: string; mid?: string; cta: string; href: string; foot: string;
}
function emailShell(a: ShellArgs): string {
  const t = TONES[a.tone];
  const rule = t.rule.startsWith("linear") ? t.rule : `linear-gradient(90deg,${t.rule},rgba(255,255,255,0))`;
  const pill = a.foil
    ? `<span style="display:inline-block;background:linear-gradient(90deg,#F1D08A,#E8B96A);color:#231604;font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;padding:6px 13px;border-radius:999px">${a.tag}</span>`
    : `<span style="display:inline-block;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.34);color:#FBF8F1;font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;padding:5px 12px;border-radius:999px">${a.tag}</span>`;
  const cta = a.foil
    ? `<table cellpadding="0" cellspacing="0"><tr><td style="background:linear-gradient(90deg,#E8B96A,#C8761B);border-radius:10px;box-shadow:0 8px 20px -8px rgba(200,118,27,.7)"><a href="${APP_URL}${a.href}" style="display:inline-block;padding:15px 38px;font-size:14px;font-weight:800;letter-spacing:.2px;color:#231604;text-decoration:none">${a.cta} &rarr;</a></td></tr></table>`
    : `<table cellpadding="0" cellspacing="0"><tr><td style="background:${t.solid};border-radius:10px"><a href="${APP_URL}${a.href}" style="display:inline-block;padding:15px 36px;font-size:14px;font-weight:800;letter-spacing:.2px;color:#FBF8F1;text-decoration:none">${a.cta} &rarr;</a></td></tr></table>`;
  const greet = a.greeting ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#5A5A72">${a.greeting}</p>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f4;padding:36px 22px"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#FBF8F1;border-radius:16px;overflow:hidden;box-shadow:0 1px 0 #EAE2D1">
      <tr><td style="background:${t.solid};background:${t.grad};padding:24px 36px 22px">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;white-space:nowrap">${csLogo()}<span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:20px;font-weight:800;letter-spacing:-0.3px;color:#FBF8F1">CastSlate</span></td>
        </tr></table>
        <div style="margin-top:16px">${pill}</div>
        <div style="height:2px;background:${rule};margin-top:18px"></div>
      </td></tr>
      <tr><td style="padding:34px 36px 10px">
        <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#1A1A2E;letter-spacing:-0.4px;line-height:1.18">${a.heading}</h1>
        ${greet}
        <p style="margin:0 0 22px;font-size:15px;line-height:1.75;color:#5A5A72">${a.body}</p>
        ${a.mid ?? ""}
        ${cta}
      </td></tr>
      <tr><td style="padding:24px 36px 30px;border-top:1px solid #EFE7D6">
        <p style="margin:0;font-size:11.5px;color:#9a9382;line-height:1.7">${a.foot}<br/>Manage notifications in <a href="${APP_URL}/account-settings" style="color:${t.solid};text-decoration:none">Account Settings &rarr; Notifications</a>.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function inboxMessageHtml(firstName: string, fromName?: string, projectName?: string): string {
  const about = projectName ? ` about <strong>${esc(projectName)}</strong>` : "";
  const body = fromName
    ? `<strong>${esc(fromName)}</strong> sent you a message${about}. Open your inbox to read it and reply.`
    : `You received a new message${about}. Open your inbox to read it and reply.`;
  return emailShell({
    tone: "teal", tag: "New message", heading: "You have a new message",
    greeting: `Hi ${firstName},`, body,
    cta: "Open inbox", href: "/inbox",
    foot: "You're receiving this because you have an account on CastSlate.",
  });
}

function classInvitationHtml(firstName: string, classTitle: string, instructorName?: string): string {
  const sub = instructorName ? `with ${esc(instructorName)}` : undefined;
  return emailShell({
    tone: "amber", tag: "Private invitation", heading: "You've been personally selected",
    body: "Our team reviewed your profile and selected you for a private, one-on-one training session with a top industry professional. Spots are limited and offered by invitation only.",
    mid: csBlock("amber", "Private invitation", esc(classTitle), sub),
    cta: "View my invitation", href: "/talent-dashboard",
    foot: "You're receiving this because a private invitation was sent to your CastSlate account.",
  });
}

function bookingApprovedHtml(firstName: string, classTitle: string, slotLabel?: string, classPrice?: string, classId?: string): string {
  const parts: string[] = [];
  if (slotLabel) parts.push(esc(slotLabel));
  if (classPrice) parts.push(esc(classPrice));
  const href = classId ? `/classes?class=${encodeURIComponent(classId)}` : "/classes";
  return emailShell({
    tone: "green", tag: "Approved", heading: "You're approved — reserve your seat",
    greeting: `Good news, ${firstName} —`,
    body: "Your booking request for the session below was approved. Your spot is held for <strong>48 hours</strong> — complete payment to lock it in.",
    mid: csBlock("green", "Session", esc(classTitle), parts.join(" &middot; ") || undefined),
    cta: "Complete payment", href,
    foot: "You're receiving this because you requested a class booking on CastSlate.",
  });
}

function bookingDeclinedHtml(firstName: string, classTitle: string, adminNote?: string): string {
  const note = adminNote ? `<br/><br/>${esc(adminNote)}` : "";
  return emailShell({
    tone: "stone", tag: "Update", heading: "An update on your booking request",
    greeting: `Hi ${firstName},`,
    body: `Thanks for your interest in <strong>${esc(classTitle)}</strong>. Unfortunately we couldn't approve your request this time — this session filled up quickly. New dates are opening soon.${note}`,
    cta: "Browse classes", href: "/classes",
    foot: "You're receiving this because you requested a class booking on CastSlate.",
  });
}

function weeklyCheckinHtml(firstName: string, task?: string): string {
  return emailShell({
    tone: "amber", foil: true, tag: "Manager Mode &middot; Weekly check-in",
    heading: "Your weekly career note is ready",
    body: "Your personalized Manager Mode check-in is waiting in your inbox — one focused step to keep you castable this week.",
    mid: task ? csBlock("amber", "This week's task", esc(task)) : undefined,
    cta: "Open my note", href: "/inbox",
    foot: "You're receiving this because Manager Mode is on for your account.",
  });
}

function premiumWelcomeHtml(firstName: string): string {
  const card = (emoji: string, title: string, body: string) =>
    `<tr><td style="background:#f7f4fd;border:1px solid #e6ddf8;border-radius:13px;padding:15px 17px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="52" valign="top">
          <span style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;font-size:19px;border-radius:11px;background:linear-gradient(135deg,#6b3ecb,#8b5cf6);box-shadow:0 4px 10px rgba(107,62,203,0.32)">${emoji}</span>
        </td>
        <td valign="top" style="padding-left:14px"><div style="font-size:15px;font-weight:800;color:#2d1052;margin:0 0 3px">${title}</div><div style="font-size:14px;line-height:1.6;color:#555">${body}</div></td>
      </tr></table>
    </td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f4;padding:40px 20px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%">
      <tr><td style="background:#dfd6f2;background:linear-gradient(110deg,#bcd0f0 0%,#c7bdea 26%,#d9bce6 46%,#f2c0cf 66%,#f8ccb6 85%,#f6d6ac 100%);padding:34px 36px 32px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="width:54px">
            <span style="display:inline-block;background:#ffffff;border-radius:13px;padding:10px;line-height:0;box-shadow:0 6px 18px rgba(60,26,110,0.22)">
              <img src="${APP_URL}/logo-email.png" alt="CastSlate" width="30" height="30" style="display:block"/>
            </span>
          </td>
          <td valign="middle" style="padding-left:14px">
            <div style="font-size:22px;font-weight:800;color:#1a0533;letter-spacing:-0.5px;line-height:1">CastSlate</div>
            <div style="margin-top:5px;font-size:11px;font-weight:700;color:#5a3aa0;letter-spacing:2.5px;text-transform:uppercase">Premium membership</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:36px 36px 8px">
        <h1 style="margin:0 0 14px;font-size:25px;font-weight:800;color:#1a0533;letter-spacing:-0.5px">Welcome to CastSlate Premium, ${firstName} 🎬</h1>
        <p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:#555">You're all set. Premium unlocks everything you need to get seen — and the more complete your profile, the more castable you become.</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#555">Here's how to get the most out of it:</p>
      </td></tr>
      <tr><td style="padding:0 36px 8px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px">
          ${card("📅", "Manager Mode — your weekly check-in", "Every week (usually Monday–Wednesday) you'll get one focused task to improve your profile and stay castable, waiting for you in your CastSlate inbox. Sign in to read it — small steps each week add up fast.")}
          ${card("📸", "Upload everything you can", "Add as many photos and headshots as possible, fill out <strong>all</strong> your stats, and record your <strong>'Cast Me As'</strong> videos and your <strong>7-second Actor's Slate</strong>. A full profile is what makes casting directors stop and look.")}
          ${card("🎞️", "Unlimited storage", "Upload demo reels, video clips, and photos with no limits — build the most complete picture of your range.")}
          ${card("💬", "Message casting directors", "Send video messages directly to CDs, right from the platform.")}
          ${card("🪪", "Your Actor Business Card + QR code", "Everything above becomes viewable anywhere, by any industry professional, in seconds — your card's QR code opens your full profile, reels, slate, and stats right in front of them.")}
        </table>
      </td></tr>
      <tr><td style="padding:22px 36px 36px" align="center">
        <a href="${APP_URL}/talent-dashboard" style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:15px 40px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">Complete Your Profile →</a>
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
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f4;padding:40px 20px"><tr><td align="center">
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
  const title = projectName ? `${esc(projectName)}${roleName ? ` &middot; ${esc(roleName)}` : ""}` : "";
  return emailShell({
    tone: "green", foil: true, tag: "Shortlisted", heading: "You've been shortlisted",
    body: `${reviewer} shortlisted you${forRole}. Your submission stood out — you're on the short list to move forward.`,
    mid: projectName ? csBlock("green", "Shortlisted", title) : undefined,
    cta: "View my applications", href: "/talent-dashboard",
    foot: "You're receiving this because a casting director took action on one of your submissions.",
  });
}

// Hold / "under consideration". This one deliberately does NOT use emailShell:
// the approved design is a solid emerald stripe, a two-line serif headline with a
// badge beside it and a dark footer band, which the shared cream shell cannot
// express without changing the other seven emails. Everything else about it —
// cream paper, Georgia headline, the tone-keyed card — still matches the family.
//
// Mobile: the only two rows that can run out of room are the two-column ones
// (mark | "Casting update", headline | badge). Both collapse under 480px via the
// <style> block, and nothing anywhere is a fixed pixel width, so a client that
// strips <style> merely wraps instead of overflowing. Outlook gets a conditional
// 560px wrapper (it ignores max-width) and the solid colour behind every gradient.
const HOLD = {
  band: "#0F5A3C", band2: "#17805A", foot: "#0B4A31",
  onDark: "#7FE3B0",          // accent that sits on the emerald stripe / footer
  onCream: "#17805A",         // darker sibling for the headline word on cream (contrast)
  kicker: "#1E7A54", card: "#EAF7F0", cardBd: "#CFEADD", cta: "#116549",
};
function applicationHoldHtml(firstName: string, projectName?: string, roleName?: string, cdName?: string): string {
  const H = HOLD;
  const forRole  = roleName ? ` for <strong>${esc(roleName)}</strong>` : "";
  const reviewer = cdName ? `<strong>${esc(cdName)}</strong>` : "A casting director";
  const title    = projectName ? `${esc(projectName)}${roleName ? ` &middot; ${esc(roleName)}` : ""}` : "";
  const body = `${reviewer} opened your submission${forRole} and moved you to under consideration ` +
               `&mdash; you're still in for the role while they finalize casting. Nothing is needed from you right now.`;
  const card = projectName ? `
        <tr><td class="cs-pad" style="padding:24px 30px 0">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="background:${H.card};border:1px solid ${H.cardBd};border-radius:12px;padding:18px 20px">
              <div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${H.kicker};margin:0 0 8px">Your submission</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:#1A1A2E;line-height:1.3">${title}</div>
            </td></tr></table>
        </td></tr>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<style>
:root{color-scheme:light;supported-color-schemes:light}
@media only screen and (max-width:480px){
  .cs-pad{padding-left:20px!important;padding-right:20px!important}
  .cs-word{font-size:20px!important;letter-spacing:1.2px!important}
  .cs-mark{width:38px!important;height:38px!important}
  .cs-kicker{display:none!important}
  .cs-h1{font-size:25px!important}
  .cs-badge-cell{width:80px!important}
  .cs-badge{width:78px!important;height:60px!important}
  .cs-cta a{padding:15px 24px!important}
}
</style></head>
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f4"><tr><td align="center" style="padding:32px 14px">
  <!--[if mso]><table width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
    <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#FCFAF7;border-radius:16px;overflow:hidden;box-shadow:0 1px 0 #EAE2D1">

      <tr><td class="cs-pad" style="background:${H.band};background:linear-gradient(115deg,${H.band2} 0%,${H.band} 62%,${H.band2} 100%);padding:22px 30px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle"><table cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:14px"><img class="cs-mark" src="${APP_URL}/logo-email-tile.png" width="46" height="46" alt="CastSlate" style="display:block;border-radius:11px"/></td>
            <td style="vertical-align:middle"><span class="cs-word" style="font-size:24px;font-weight:800;letter-spacing:1.7px;color:#FFFFFF;white-space:nowrap">CASTSLATE</span></td>
          </tr></table></td>
          <td class="cs-kicker" align="right" style="vertical-align:middle;padding-left:18px"><span style="font-size:10px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:${H.onDark}">Casting update</span></td>
        </tr></table>
      </td></tr>

      <tr><td style="height:4px;line-height:4px;font-size:0;background:#2E9B6C;background:linear-gradient(90deg,${H.onDark},#2E9B6C 52%,rgba(15,90,60,0))">&nbsp;</td></tr>

      <tr><td class="cs-pad" style="padding:34px 30px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top">
            <h1 class="cs-h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;color:#1A1A2E;letter-spacing:-0.5px;line-height:1.22">Your profile was<br/><span style="color:${H.onCream}">reviewed</span></h1>
          </td>
          <td class="cs-badge-cell" align="right" style="vertical-align:top;width:112px">
            <img class="cs-badge" src="${APP_URL}/email-hold-badge.png" width="104" height="80" alt="" style="display:block;border:0"/>
          </td>
        </tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="padding:20px 30px 0"><p style="margin:0;font-size:15px;line-height:1.78;color:#5A5A72">${body}</p></td></tr>
${card}
      <tr><td class="cs-pad cs-cta" style="padding:26px 30px 34px">
        <table cellpadding="0" cellspacing="0"><tr><td style="background:${H.cta};border-radius:11px">
          <a href="${APP_URL}/talent-dashboard" style="display:inline-block;padding:16px 34px;font-size:14.5px;font-weight:800;letter-spacing:0.2px;color:#FFFFFF;text-decoration:none">View my applications &nbsp;&rarr;</a>
        </td></tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="background:${H.foot};padding:22px 30px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;width:38px;padding-top:2px"><img src="${APP_URL}/email-bell.png" width="26" height="26" alt="" style="display:block;border:0"/></td>
          <td style="vertical-align:top"><p style="margin:0;font-size:12px;line-height:1.75;color:rgba(255,255,255,0.70)">You're receiving this because a casting director took action on one of your submissions.<br/>Manage notifications in <a href="${APP_URL}/account-settings" style="color:${H.onDark};text-decoration:none;font-weight:700">Account Settings</a>.</p></td>
        </tr></table>
      </td></tr>

    </table>
  <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
}

function activityDigestHtml(firstName: string, profileViews: number, tapeViews: number, shortlists: number): string {
  const t = TONES.teal;
  const row = (icon: string, text: string) =>
    `<tr><td style="padding:13px 16px;background:${t.soft};border:1px solid ${t.solid}22;border-radius:10px"><span style="display:inline-block;width:28px;color:${t.solid};font-size:17px;vertical-align:middle">${icon}</span><span style="font-size:15.5px;color:#1A1A2E;vertical-align:middle">${text}</span></td></tr><tr><td style="height:8px"></td></tr>`;
  const rows = [
    shortlists > 0 ? row("&#9733;", `<strong>${shortlists}</strong> casting ${shortlists === 1 ? "director" : "directors"} shortlisted you`) : "",
    profileViews > 0 ? row("&#9673;", `<strong>${profileViews}</strong> casting ${profileViews === 1 ? "director" : "directors"} viewed your profile`) : "",
    tapeViews > 0 ? row("&#9658;", `<strong>${tapeViews}</strong> watched your audition ${tapeViews === 1 ? "reel" : "reels"}`) : "",
  ].join("");
  const mid = `<table width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px">${rows}</table>`;
  return emailShell({
    tone: "teal", tag: "Daily recap", heading: `You're getting noticed, ${firstName}`,
    body: "Here's the attention your work drew on CastSlate in the last day:",
    mid, cta: "View my dashboard", href: "/talent-dashboard",
    foot: "You're receiving this because casting directors engaged with your submissions.",
  });
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

    // Gate: shared secret (database callers), service role (weekly-checkin-run), or a
    // signed-in user's JWT (the app). An anon key alone resolves to no user and fails.
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    let authorized = false;
    if (bearer) {
      if (SUPABASE_SERVICE_KEY && bearer === SUPABASE_SERVICE_KEY) authorized = true;
      if (!authorized) {
        const { data: secretRow } = await supabase.from("app_secrets").select("value").eq("key", "notify_fn_secret").maybeSingle();
        if (secretRow?.value && bearer === secretRow.value) authorized = true;
      }
      if (!authorized) {
        try {
          const { data: u } = await supabase.auth.getUser(bearer);
          if (u?.user?.id) authorized = true;
        } catch (_) { /* not a user token */ }
      }
    }
    if (!authorized) {
      console.warn("[send-notification-email] unauthorized call, type=", type);
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("display_name, membership_status, notification_email, notification_messages, notification_applications, notification_marketing, notification_sms, phone")
      .eq("id", to_user_id)
      .maybeSingle();

    if (profileErr || !profile) {
      return json({ error: "User profile not found" }, 404);
    }

    // Premium members get their email as normal. The single exception is the Manager Mode
    // weekly note, which is delivered in-app and read on the site.
    if (profile.membership_status === "active" && PREMIUM_EMAIL_BLOCKED.has(type)) {
      return json({ ok: true, results: { email: "skipped:premium_in_app_only" } });
    }

    // ── Global do-not-email hub: if this user's address has bounced,
    //    complained, or unsubscribed (campaign tool or resend-webhook), skip
    //    every transactional send. Resolve the auth email once and check it. ──
    {
      const { data: authEarly } = await supabase.auth.admin.getUserById(to_user_id);
      const em = authEarly?.user?.email?.trim().toLowerCase();
      if (em) {
        const { data: sup } = await supabase
          .from("email_unsubscribes").select("email").ilike("email", em).maybeSingle();
        if (sup) {
          return json({ ok: true, results: { email: "skipped:suppressed" } });
        }
      }
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

    // ── Application on hold ("you're under consideration") ──
    // Softer sibling of the shortlist email, fired when a CD moves an actor to
    // Hold. Same opt-out gating as the shortlist email.
    if (type === "application_hold") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailEnabled = profile.notification_email !== false && profile.notification_applications !== false;
      if (!emailEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      if (!emailConfigured()) {
        console.warn("[send-notification-email] email provider not configured — skipping hold email");
        return json({ ok: true, results: { email: "skipped:EMAIL_NOT_CONFIGURED" } });
      }
      const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(to_user_id);
      if (authErr || !authData?.user?.email) {
        return json({ ok: false, results: { email: "error:could_not_retrieve_user_email" } });
      }
      const sent = await sendEmail({
        from: FROM_EMAIL, to: [authData.user.email], replyTo: CONTACT_EMAIL,
        subject: `${firstName}, your profile was reviewed on CastSlate`,
        html: applicationHoldHtml(firstName, project_name?.trim() || undefined, role_name?.trim() || undefined, cd_name?.trim() || undefined),
      });
      if (!sent.ok) {
        console.error("[send-notification-email] hold send error:", sent.err);
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

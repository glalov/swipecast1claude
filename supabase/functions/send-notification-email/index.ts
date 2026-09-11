// send-notification-email — Supabase Edge Function
// Sends transactional notifications via email (Resend or Amazon SES) and Twilio (SMS).
//
// ⚠ BEFORE DEPLOYING: diff this file against the DEPLOYED function first. Edits have been
// made directly to the live function without coming back here, and a blind deploy from the
// repo has already been one keystroke away from removing the authorization gate below and
// reverting the standardized surrounds (warm cream CS_CREAM since 2026-09-10, with the
// universal footer A). Fetch the live source, diff, reconcile.
//
// AUTHORIZATION: this endpoint used to accept anonymous POSTs, so anyone who knew the URL
// could send mail to any user id. Callers must now present one of: the shared
// notify_fn_secret (the database functions, via public.notify_fn_secret()), the service
// role key (weekly-checkin-run), or a signed-in user's JWT (the app itself). verify_jwt
// stays false because the DB callers are not JWT-bearing — the check below is the gate.
//
// PREMIUM MEMBERS RECEIVE EMAIL NORMALLY — inbox messages, shortlists, holds, class and
// event invitations, booking updates, and the premium welcome all send exactly as they
// do for free accounts. Two types are withheld:
//   • 'weekly_checkin' — the Manager Mode weekly note lives in the member's inbox on the
//     site and is read there. Emailing it was what turned a quiet week into a
//     cancellation, so the note is delivered in-app and never mailed.
//   • 'activity_digest' — the daily "you're getting noticed" recap is for NON-premium
//     accounts only (owner's rule, 2026-09-10). Also filtered in run_activity_digest().
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

// ── Universal email footer "A · Cream Colophon" (approved 2026-09-10) ─────────
// The SAME helpers live in every CastSlate email function: send-notification-
// email, day2-getnoticed, premium-upsell, process-digest-queue, weekly-upsell,
// winback-run and member-announce. Change one, change all seven. Each email
// passes its own "why you got this" sentence, accent colour and unsubscribe URL.
const CS_CREAM = "#F3EEE6";
function csFooterStripe(accent: string): string {
  return `<tr><td style="height:6px;line-height:6px;font-size:0;background:${accent};background:linear-gradient(90deg,${accent},${accent} 55%,${accent}55)">&nbsp;</td></tr>`;
}
function csFooterA(reason: string, accent: string, unsubUrl: string): string {
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const serif = "Georgia,'Times New Roman',serif";
  const fb = "https://www.facebook.com/people/CastSlate/61590920810941/";
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:560px;margin:0 auto">
  <tr><td align="center" style="padding:30px 22px 40px">
    <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="max-width:500px;width:100%">
      <tr><td align="center" style="padding-bottom:10px"><table cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td style="padding-right:10px;vertical-align:middle"><img src="${APP_URL}/logo-email-tile.png" width="34" height="34" alt="CastSlate" style="display:block;border-radius:8px"/></td>
        <td style="vertical-align:middle;font-family:${sans};font-size:17px;font-weight:800;letter-spacing:2.4px;color:#1A1A2E">CASTSLATE</td>
      </tr></table></td></tr>
      <tr><td align="center" style="font-family:${serif};font-style:italic;font-size:14px;color:#8A7A66;padding-bottom:20px">Get seen. Get cast.</td></tr>
      <tr><td align="center" style="font-family:${sans};font-size:12.5px;line-height:1.7;color:#7A7064;padding-bottom:18px">${reason}</td></tr>
      <tr><td align="center" style="font-family:${sans};font-size:13px;font-weight:700;color:#2B2622;padding-bottom:3px">Getting too many emails, or not enough?</td></tr>
      <tr><td align="center" style="padding-bottom:12px"><a href="${APP_URL}/account-settings" style="font-family:${sans};font-size:13px;font-weight:700;color:${accent};text-decoration:none">Choose what you receive &rarr;</a></td></tr>
      <tr><td align="center" style="font-family:${sans};font-size:12.5px;color:#7A7064;padding-bottom:22px">Or to stop completely, <a href="${unsubUrl}" style="color:${accent};text-decoration:underline">unsubscribe</a>.</td></tr>
      <tr><td align="center" style="padding-bottom:20px"><a href="${fb}" style="text-decoration:none"><table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr><td width="30" height="30" align="center" style="width:30px;height:30px;background:${accent};border-radius:15px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:30px;color:#FFFFFF;text-align:center">f</td></tr></table></a></td></tr>
      <tr><td align="center" style="border-top:1px solid #E2D9CB;padding-top:16px;font-family:${sans};font-size:11.5px;color:#A39684">&copy; ${new Date().getFullYear()} CastSlate &middot; <a href="mailto:team@castslate.com" style="color:#8A7A66;text-decoration:none">team@castslate.com</a></td></tr>
    </table>
  </td></tr>
</table>`;
}

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
const PREMIUM_EMAIL_BLOCKED = new Set(["weekly_checkin", "activity_digest"]);

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
<body style="margin:0;padding:0;background:${CS_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CS_CREAM};padding:36px 22px"><tr><td align="center">
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
      ${csFooterStripe(t.solid)}
    </table>
    ${csFooterA(a.foot, t.solid, `${APP_URL}/account-settings`)}
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
    `<tr><td class="pw-card" height="84" style="height:84px;background:#f7f4fd;border:1px solid #e6ddf8;border-radius:13px;padding:0 18px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="54" valign="middle">
          <span style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;font-size:19px;border-radius:11px;background:linear-gradient(135deg,#6b3ecb,#8b5cf6)">${emoji}</span>
        </td>
        <td valign="middle" style="padding-left:12px"><div style="font-size:15px;font-weight:800;color:#2d1052;margin:0 0 3px;line-height:1.3">${title}</div><div style="font-size:14px;line-height:1.55;color:#555">${body}</div></td>
      </tr></table>
    </td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
@media only screen and (max-width:480px){
  .pw-outer{padding:20px 8px!important}
  .pw-pad{padding-left:18px!important;padding-right:18px!important}
  .pw-note{padding-left:18px!important;padding-right:18px!important}
  .pw-card{padding:12px 14px!important;height:108px!important}
}
</style></head><body style="margin:0;padding:0;background:${CS_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CS_CREAM}"><tr><td class="pw-outer" align="center" style="padding:40px 20px">
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
      <tr><td class="pw-pad" style="padding:36px 36px 8px">
        <h1 style="margin:0 0 14px;font-size:25px;font-weight:800;color:#1a0533;letter-spacing:-0.5px">Welcome to CastSlate Premium, ${firstName} 🎬</h1>
        <p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:#555">You're all set. Premium unlocks everything you need to get seen — and the more complete your profile, the more castable you become.</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#555">Here's how to get the most out of it:</p>
      </td></tr>
      <tr><td class="pw-pad" style="padding:0 36px 8px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px">
          ${card("📅", "Manager Mode — your weekly check-in", "One focused task every week (Mon–Wed), waiting in your CastSlate inbox.")}
          ${card("📸", "Upload everything you can", "Photos, all your stats, <strong>'Cast Me As'</strong> videos and your <strong>7-second Actor's Slate</strong>.")}
          ${card("🎞️", "Unlimited storage", "Demo reels, video clips and photos with no limits. Show your full range.")}
          ${card("💬", "Message casting directors", "Send video messages directly to CDs, right from the platform.")}
          ${card("🏛️", "Agency &amp; Manager Directory", "<strong>650+</strong> agencies and managers in LA &amp; NY, with how each one takes submissions.")}
          ${card("🪪", "Actor Business Card + QR code", "One scan opens your full profile, reels, slate and stats for any industry pro.")}
        </table>
      </td></tr>
      <!-- "How to waste your membership" note -->
      <tr><td class="pw-pad" style="padding:18px 36px 6px">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f1;border:1px solid #f3dcc6;border-radius:16px">
          <tr><td class="pw-note" style="padding:26px 26px 8px">
            <div style="font-size:10.5px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:#c4622d;margin:0 0 8px">A friendly warning</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#1a0533;letter-spacing:-0.3px;line-height:1.2;margin:0 0 10px">How to waste your membership 🙃</div>
            <div style="font-size:15px;line-height:1.7;color:#5a4a44">We've seen a lot of Premium profiles, and there are two tried-and-true ways to get absolutely nothing out of yours. Please don't try either of them.</div>
          </td></tr>

          <!-- Waste #1 -->
          <tr><td class="pw-note" style="padding:18px 26px 4px">
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>
              <td width="40" valign="middle" style="width:40px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:15px;background:#e0784a;color:#ffffff;font-size:14px;font-weight:800">1</span></td>
              <td valign="middle" style="font-size:16px;font-weight:800;color:#2d1052;line-height:1.35">Upload one or two photos… and call it a day</td>
            </tr></table>
            <div style="font-size:14.5px;line-height:1.7;color:#555;margin:0 0 10px">It's the classic move: one lonely headshot, maybe a second, and not a single video. Your storage is <strong>unlimited</strong>, so you can upload literally <strong>hundreds</strong> of photos and videos. Fill it up and your profile becomes your own personal website.</div>
            <div style="font-size:14.5px;line-height:1.7;color:#555">Casting directors, agents and managers today want to see you <strong>on video</strong>. No professional footage? No problem. Grab your phone and record a monologue, or shoot a scene with a friend. Nobody in the industry cares whether it was shot on an ARRI Alexa or an iPhone. They care about <strong>the acting</strong>.</div>
          </td></tr>

          <!-- Waste #2 -->
          <tr><td class="pw-note" style="padding:20px 26px 4px">
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>
              <td width="40" valign="middle" style="width:40px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:15px;background:#e0784a;color:#ffffff;font-size:14px;font-weight:800">2</span></td>
              <td valign="middle" style="font-size:16px;font-weight:800;color:#2d1052;line-height:1.35">Never print a single business card</td>
            </tr></table>
            <div style="font-size:14.5px;line-height:1.7;color:#555;margin:0 0 10px">The runner-up: ignore the built-in <strong>Business Card builder</strong> and its <strong>three printable mailing cards</strong>, and never open the <strong>Talent Agency &amp; Manager Directory</strong>.</div>
            <div style="font-size:14.5px;line-height:1.7;color:#555">Do the opposite. Print your cards and start mailing agents and managers now. In this industry you never know whose desk your card will land on, and you might be exactly the face and energy they're looking for. Nobody is going to knock on your door. You have to go out there and let them know you exist.</div>
          </td></tr>

          <!-- What they actually care about -->
          <tr><td class="pw-note" style="padding:22px 26px 4px">
            <div style="border-top:1px dashed #efcfb3;padding-top:20px">
              <div style="font-size:16px;font-weight:800;color:#2d1052;margin:0 0 6px">What they actually care about</div>
              <div style="font-size:14.5px;line-height:1.7;color:#555">Fill out your whole profile: write your bio and add your measurements and credits. No credits yet? That's completely fine. Filmmakers aren't reading long résumés. They care about two things: <strong>do you have basic acting ability</strong>, and <strong>are you the right person for the part?</strong> If you are, they'll cast you and coach you through the rest. They know the tricks.</div>
            </div>
          </td></tr>

          <!-- Johnny Depp story -->
          <tr><td class="pw-note" style="padding:18px 26px 6px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="background:#ffffff;border:1px solid #efe3f9;border-left:3px solid #8b5cf6;border-radius:10px;padding:16px 18px">
                <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#6b3ecb;margin:0 0 7px">Case in point</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:15.5px;line-height:1.65;color:#2d1052">Johnny Depp never planned to be an actor. He came to Los Angeles chasing a music career, and when the band wasn't paying the rent, a friend introduced him to an agent. He walked into his first audition with no acting experience at all, and his look caught the director's eye on the spot. That role was <em>A Nightmare on Elm Street</em>, and the rest is history.</div>
              </td>
            </tr></table>
          </td></tr>

          <tr><td class="pw-note" style="padding:16px 26px 24px">
            <div style="font-size:15px;line-height:1.7;color:#5a4a44">So don't waste it. Upload the videos, print the cards, send the mail, and make them aware you exist. We'll be cheering you on every step of the way. 💜</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td class="pw-pad" style="padding:22px 36px 36px" align="center">
        <a href="${APP_URL}/talent-dashboard" style="display:inline-block;background:linear-gradient(90deg,#6b3ecb,#8b5cf6);color:#fff;text-decoration:none;padding:15px 40px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">Complete Your Profile →</a>
      </td></tr>
      ${csFooterStripe("#6b3ecb")}
    </table>
    ${csFooterA("You're receiving this because you upgraded to CastSlate Premium.", "#6b3ecb", `${APP_URL}/account-settings`)}
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
<body style="margin:0;padding:0;background:${CS_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CS_CREAM};padding:40px 20px"><tr><td align="center">
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
          ${step("🎬", "3 &middot; Browse castings &amp; send your first submission", "Your <strong>first submission is free</strong>. Find a role that fits and apply — every submission is reviewed by the casting director individually.")}
        </table>
      </td></tr>

      <tr><td style="padding:18px 36px 26px" align="center">
        <a href="${APP_URL}/my-profile" style="display:inline-block;background:linear-gradient(90deg,#4F8A8B,#37696A);color:#fff;text-decoration:none;padding:15px 40px;border-radius:10px;font-weight:800;font-size:15px;letter-spacing:0.1px">Add my headshot →</a>
      </td></tr>

      <tr><td style="padding:0 36px 30px">
        <div style="background:#f4f9f9;border:1px dashed #bfdcdc;border-radius:12px;padding:16px 18px">
          <div style="font-size:13px;font-weight:800;color:#1A1A2E;margin:0 0 4px">Want to move faster?</div>
          <div style="font-size:13.5px;line-height:1.6;color:#555">Premium is <strong>$99 a year ($8.25/month)</strong>, or $14.95/month — it unlocks <strong>unlimited submissions</strong>, unlimited photos &amp; videos, your Actor's Slate, an Actor Business Card with a QR code, and the <strong>Talent Agency &amp; Manager Directory</strong> — 650+ agencies and management companies across LA and New York, with the submission route each one actually accepts. Start free — upgrade whenever you're ready.</div>
        </div>
      </td></tr>

      ${csFooterStripe("#37696A")}

    </table>
    ${csFooterA("You're receiving this because you created a CastSlate account.", "#37696A", `${APP_URL}/account-settings`)}
  </td></tr></table>
</body></html>`;
}

// ── Casting-decision emails (shortlist + hold) ─────────────────────────────
// These two deliberately do NOT use emailShell: the approved design is a solid
// colour stripe, a two-line serif headline with a badge beside it and a dark
// footer band, which the shared cream shell cannot express without changing the
// other six emails. Everything else still matches the family — cream paper,
// Georgia headline, a tinted detail card.
//
// The two must stay visually distinct: shortlisted (the win) is sapphire with a
// star, hold (still deciding) is emerald with a check. Same colour for both would
// make the best news and the "no decision yet" news look identical in the inbox.
//
// Stripe colours are always LIGHTER and more saturated than the navy cube in the
// masthead — on a midnight-navy stripe the mark stops separating from it.
//
// Mobile: the only two rows that can run out of room are the two-column ones
// (mark | "Casting update", headline | badge). Both collapse under 480px via the
// <style> block, and nothing anywhere is a fixed pixel width, so a client that
// strips <style> merely wraps instead of overflowing. Outlook gets a conditional
// 560px wrapper (it ignores max-width) and the solid colour behind every gradient.
interface DecisionTone {
  band: string; band2: string; foot: string;
  onDark: string;   // accent that sits ON the stripe / footer band
  onCream: string;  // darker sibling for the headline word (contrast on cream)
  rule: string; rule0: string;   // rule mid-tone, and the same hue at zero alpha to fade into
  kicker: string; card: string; cardBd: string; cta: string;
  badge: string;    // filename of the hexagon badge PNG
  bell: string;     // filename of the footer bell PNG, tinted to match
}
const SHORTLIST_TONE: DecisionTone = {
  band: "#1C46A8", band2: "#2A62D8", foot: "#153784",
  onDark: "#A6C6FF", onCream: "#1F4FBB", rule: "#3E75DD", rule0: "rgba(28,70,168,0)",
  kicker: "#1F4FBB", card: "#EDF3FE", cardBd: "#D6E3FA", cta: "#1C46A8",
  badge: "email-shortlist-badge.png", bell: "email-bell-sapphire.png",
};
const HOLD_TONE: DecisionTone = {
  band: "#0F5A3C", band2: "#17805A", foot: "#0B4A31",
  onDark: "#7FE3B0", onCream: "#17805A", rule: "#2E9B6C", rule0: "rgba(15,90,60,0)",
  kicker: "#1E7A54", card: "#EAF7F0", cardBd: "#CFEADD", cta: "#116549",
  badge: "email-hold-badge.png", bell: "email-bell.png",
};

// Rose Ember — the daily "you're getting noticed" recap. Deliberately clear of
// both the sapphire shortlist and the emerald hold: this is interest, not a
// decision, so the tone is warm and personal rather than a win or a verdict.
const NOTICED_TONE: DecisionTone = {
  band: "#7C2438", band2: "#B5455F", foot: "#4A121F",
  onDark: "#F7B9C6", onCream: "#A93A55", rule: "#D2607A", rule0: "rgba(124,36,56,0)",
  kicker: "#8E2A42", card: "#FCEFF2", cardBd: "#F2D3DB", cta: "#8E2A42",
  badge: "email-noticed-badge.png", bell: "email-bell-rose.png",
};

interface DecisionArgs {
  tone: DecisionTone; headTop: string; headAccent: string; body: string; title: string;
  // Optional overrides so the same shell can carry a non-decision email (the
  // daily recap). Left unset, every one of these keeps the shortlist/hold
  // wording byte-for-byte identical to what shipped.
  kicker?: string; mid?: string; cta?: string; href?: string; foot?: string;
}
function decisionEmail(a: DecisionArgs): string {
  const t = a.tone;
  const card = a.title ? `
        <tr><td class="cs-pad" style="padding:24px 30px 0">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="background:${t.card};border:1px solid ${t.cardBd};border-radius:12px;padding:18px 20px">
              <div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${t.kicker};margin:0 0 8px">Your submission</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:#1A1A2E;line-height:1.3">${a.title}</div>
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
<body style="margin:0;padding:0;background:${CS_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CS_CREAM}"><tr><td align="center" style="padding:32px 14px">
  <!--[if mso]><table width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
    <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#FCFAF7;border-radius:16px;overflow:hidden;box-shadow:0 1px 0 #EAE2D1">

      <tr><td class="cs-pad" style="background:${t.band};background:linear-gradient(115deg,${t.band2} 0%,${t.band} 62%,${t.band2} 100%);padding:22px 30px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle"><table cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:14px"><img class="cs-mark" src="${APP_URL}/logo-email-tile.png" width="46" height="46" alt="CastSlate" style="display:block;border-radius:11px"/></td>
            <td style="vertical-align:middle"><span class="cs-word" style="font-size:24px;font-weight:800;letter-spacing:1.7px;color:#FFFFFF;white-space:nowrap">CASTSLATE</span></td>
          </tr></table></td>
          <td class="cs-kicker" align="right" style="vertical-align:middle;padding-left:18px"><span style="font-size:10px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:${t.onDark}">${a.kicker ?? "Casting update"}</span></td>
        </tr></table>
      </td></tr>

      <tr><td style="height:4px;line-height:4px;font-size:0;background:${t.rule};background:linear-gradient(90deg,${t.onDark},${t.rule} 52%,${t.rule0})">&nbsp;</td></tr>

      <tr><td class="cs-pad" style="padding:34px 30px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top">
            <h1 class="cs-h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;color:#1A1A2E;letter-spacing:-0.5px;line-height:1.22">${a.headTop}<br/><span style="color:${t.onCream}">${a.headAccent}</span></h1>
          </td>
          <td class="cs-badge-cell" align="right" style="vertical-align:top;width:112px">
            <img class="cs-badge" src="${APP_URL}/${t.badge}" width="104" height="80" alt="" style="display:block;border:0"/>
          </td>
        </tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="padding:20px 30px 0"><p style="margin:0;font-size:15px;line-height:1.78;color:#5A5A72">${a.body}</p></td></tr>
${a.mid ?? card}
      <tr><td class="cs-pad cs-cta" style="padding:26px 30px 34px">
        <table cellpadding="0" cellspacing="0"><tr><td style="background:${t.cta};border-radius:11px">
          <a href="${APP_URL}${a.href ?? "/talent-dashboard"}" style="display:inline-block;padding:16px 34px;font-size:14.5px;font-weight:800;letter-spacing:0.2px;color:#FFFFFF;text-decoration:none">${a.cta ?? "View my applications"} &nbsp;&rarr;</a>
        </td></tr></table>
      </td></tr>

      ${csFooterStripe(t.cta)}

    </table>
    ${csFooterA(a.foot ?? "You're receiving this because a casting director took action on one of your submissions.", t.cta, `${APP_URL}/account-settings`)}
  <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
}

function applicationSelectedHtml(firstName: string, projectName?: string, roleName?: string, cdName?: string): string {
  const forRole  = roleName ? ` for <strong>${esc(roleName)}</strong>` : "";
  const reviewer = cdName ? `<strong>${esc(cdName)}</strong>` : "A casting director";
  const title    = projectName ? `${esc(projectName)}${roleName ? ` &middot; ${esc(roleName)}` : ""}` : "";
  return decisionEmail({
    tone: SHORTLIST_TONE,
    headTop: "You&rsquo;ve been", headAccent: "shortlisted",
    body: `${reviewer} shortlisted you${forRole}. Your submission stood out &mdash; you're on the short list to move forward.`,
    title,
  });
}

function applicationHoldHtml(firstName: string, projectName?: string, roleName?: string, cdName?: string): string {
  const forRole  = roleName ? ` for <strong>${esc(roleName)}</strong>` : "";
  const reviewer = cdName ? `<strong>${esc(cdName)}</strong>` : "A casting director";
  const title    = projectName ? `${esc(projectName)}${roleName ? ` &middot; ${esc(roleName)}` : ""}` : "";
  return decisionEmail({
    tone: HOLD_TONE,
    headTop: "Your profile was", headAccent: "reviewed",
    body: `${reviewer} opened your submission${forRole} and moved you to under consideration ` +
          `&mdash; you're still in for the role while they finalize casting. Nothing is needed from you right now.`,
    title,
  });
}

// Same five-item checklist (and so the same %) the Day-2 email and
// day2_eligible_actors() use: headshot, height+weight, skills, bio, credits.
// deno-lint-ignore no-explicit-any
function profileCompletionPct(p: any): number {
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
  const done = [
    has(p.headshot_url),
    has(p.height) && has(p.weight),
    Array.isArray(p.skills) && p.skills.filter(Boolean).length > 0,
    has(p.bio),
    has(p.credits),
  ].filter(Boolean).length;
  return Math.round(done / 5 * 100);
}

// "Profile strength" replaced "Reel plays" (2026-09-10): free accounts can't
// upload a reel, so that line was inaccurate. The % is the member's real
// completion, read at send time, and the card is always present.
function activityDigestHtml(firstName: string, profileViews: number, profilePct: number, shortlists: number): string {
  const t = NOTICED_TONE;
  const row = (glyph: string, label: string, text: string) => `
        <tr><td style="background:${t.card};border:1px solid ${t.cardBd};border-radius:12px;padding:16px 18px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="width:44px;vertical-align:middle;padding-right:14px">
              <table cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" style="width:40px;height:40px;background:${t.band2};border-radius:20px;text-align:center;vertical-align:middle;font-size:19px;line-height:40px;color:#FFFFFF;font-weight:700">${glyph}</td></tr></table>
            </td>
            <td style="vertical-align:middle">
              <div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${t.kicker};margin:0 0 4px">${label}</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;color:#1A1A2E;line-height:1.3">${text}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>`;

  const rows = [
    shortlists   > 0 ? row("&#9733;", "Shortlisted",   `${shortlists} casting ${shortlists === 1 ? "director" : "directors"} shortlisted you`) : "",
    profileViews > 0 ? row("&#9673;", "Profile views", `${profileViews} casting ${profileViews === 1 ? "director" : "directors"} viewed your profile`) : "",
    row("%", "Profile strength", `Your profile is ${profilePct}% complete`),
  ].join("");
  const mid = `
        <tr><td class="cs-pad" style="padding:22px 30px 0">
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td></tr>`;

  return decisionEmail({
    tone: t,
    kicker: "Daily recap",
    headTop: "You&rsquo;re getting", headAccent: `noticed, ${esc(firstName)}`,
    body: "Here's the attention your work drew on CastSlate in the last day.",
    title: "", mid,
    cta: "View my dashboard", href: "/talent-dashboard",
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
    const { to_user_id, type, from_id, from_name: rawFromName, application_id, casting_id, class_title, instructor_name, slot_label, admin_note, class_price, class_id, task, project_name, role_name, cd_name, profile_views, shortlists } = (await req.json()) as NotifyRequest;

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

    // ── Application on hold ("your profile was reviewed") ──
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
    //    per day recapping profile views / shortlists, plus the member's real
    //    profile-completion %. Non-premium only (PREMIUM_EMAIL_BLOCKED above).
    //    Gated on the applications preference, same opt-out as shortlists. ──
    if (type === "activity_digest") {
      const firstName = (profile.display_name ?? "").split(" ")[0].trim() || "there";
      const emailEnabled = profile.notification_email !== false && profile.notification_applications !== false;
      if (!emailEnabled) {
        return json({ ok: true, results: { email: "skipped:notifications_disabled_by_user" } });
      }
      const pv = Math.max(0, Math.round(Number(profile_views) || 0));
      const sl = Math.max(0, Math.round(Number(shortlists) || 0));
      if (pv + sl === 0) {
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
      const { data: checklist } = await supabase
        .from("profiles")
        .select("headshot_url, height, weight, skills, bio, credits")
        .eq("id", to_user_id)
        .maybeSingle();
      const sent = await sendEmail({
        from: FROM_EMAIL, to: [authData.user.email], replyTo: CONTACT_EMAIL,
        subject: "You're getting noticed on CastSlate",
        html: activityDigestHtml(firstName, pv, profileCompletionPct(checklist ?? {}), sl),
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

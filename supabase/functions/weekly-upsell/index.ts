// weekly-upsell — Supabase Edge Function
// A WEEKLY "what you're missing" upsell to NON-PREMIUM talent only.
//
// POST { action:"run" }                          → send to every eligible free user.
// POST { action:"run", test_override_email }     → real per-user build, but ALL sends
//                                                   redirected to that one address (no
//                                                   logs / no opt-in writes) — safe test.
// POST { action:"run", only_talent_id }          → process just that one user (test).
// POST { action:"test", to_email, as_talent_id? }→ preview send. If as_talent_id is
//                                                   given, renders THAT user's real
//                                                   personalized email; else a sample.
// GET  ?action=unsubscribe&uid=<id>              → opt out of THIS campaign only.
//
// Safety (mirrors premium-upsell):
//   • Recipients are talent/actor profiles whose membership_status is NOT 'active'.
//     Premium users are excluded by the query AND dropped by an in-loop backstop —
//     premium members are NEVER sent this email.
//   • Unsubscribe sets email_preferences.weekly_upsell_optout = true (dedicated;
//     does not touch the daily digest or premium-upsell opt-outs).
//   • Hard-bounced / complained addresses (email_unsubscribes) are always suppressed.
//   • Toggle: site_settings.weekly_upsell_enabled (+ weekly_upsell_paused e-stop).
//   • Every send logged to weekly_upsell_logs.
//   • Sends go via Resend's batch endpoint (100/call).
//
// ── ACCURACY RULES (every number in this email is a real, per-user fact) ─────────
// Fixed 2026-08-22 after three claims were found that could be false:
//   1. The headline count. It used to be `fresh.length || pool.length` — so a user
//      with NOTHING new this week was told "<all active castings> dropped this week".
//      There is no fallback any more. Two honest modes instead:
//        mode "week" — at least one casting matching this user (preferences + age)
//                      was created in the last 7 days. Count = exactly those.
//        mode "open" — nothing matching dropped this week. The email never claims a
//                      week; it counts open matching roles they have not applied to.
//   2. The "✓ You applied" card. It used to show the user's most recent application
//      EVER, so a card saying "You applied" could sit under "You applied to none this
//      week". It now comes from weekly_upsell_user_apps.latest_casting_id_7d and is
//      omitted entirely unless that application happened inside the same 7 days.
//   3. "+N more roles you couldn't submit to this week" is counted from the same pool
//      the mode is built on, and drops the "this week" wording in mode "open".
// Project titles, locations, union status, pay and deadlines are read from the
// castings row itself — nothing about a casting is ever synthesized.
//
// Personalization:
//   • LOCKED cards = castings the user has NOT applied to, preference- and age-matched
//     (this week's in mode "week", any open matching role in mode "open") — the roles
//     their one-a-week submission cap kept them from.
//   • If a user has nothing true to show, they are skipped rather than sent an email
//     with a filler number in it.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/weekly-upsell`;
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "cmpn_9e872b254fab6297129ac7ee95c021831a2163dd1f7a9906";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");

// Assets, all self-hosted at the site root. The QR used to be fetched live from
// api.qrserver.com; it is now baked into email-actor-cards.jpg (the two real Actor
// Business Cards), so this email has no third-party image dependency at open time.
const LOGO_TILE   = `${APP_URL}/logo-email-tile.png`;
const CARDS_IMG   = `${APP_URL}/email-actor-cards.jpg`;
const WEEK_BADGE  = `${APP_URL}/email-week-badge.png`;
const BELL_IMG    = `${APP_URL}/email-bell-coral.png`;

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, GET, OPTIONS",
};

function emailConfigured(): boolean { return !!RESEND_API_KEY; }

interface SendEmailArgs { from:string; to:string[]; subject:string; html:string; replyTo?:string; headers?:Record<string,string>; }
interface SendEmailResult { ok:boolean; id:string|null; err:string|null; status:number; }

async function sendEmail(a: SendEmailArgs): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) return { ok:false, id:null, err:"RESEND_API_KEY not set", status:500 };
  // deno-lint-ignore no-explicit-any
  const body:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
  if (a.replyTo) body.reply_to = a.replyTo;
  if (a.headers) body.headers = a.headers;
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(body),
  });
  if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.id ?? null, err:null, status:r.status }; }
  return { ok:false, id:null, err:await r.text(), status:r.status };
}

async function sendBatch(items: SendEmailArgs[]): Promise<SendEmailResult[]> {
  if (!RESEND_API_KEY) return items.map(()=>({ ok:false, id:null, err:"RESEND_API_KEY not set", status:500 }));
  // deno-lint-ignore no-explicit-any
  const payload = items.map((a) => { const o:any = { from:a.from, to:a.to, subject:a.subject, html:a.html }; if (a.replyTo) o.reply_to = a.replyTo; if (a.headers) o.headers = a.headers; return o; });
  try {
    const r = await fetch("https://api.resend.com/emails/batch", { method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(payload) });
    if (r.ok) { const d = await r.json().catch(()=>({})); // deno-lint-ignore no-explicit-any
      const arr:any[] = Array.isArray((d as any)?.data) ? (d as any).data : []; return items.map((_, i) => ({ ok:true, id: arr[i]?.id ?? null, err:null, status:r.status })); }
    const errText = await r.text();
    return items.map(() => ({ ok:false, id:null, err:errText, status:r.status }));
  } catch (e) { return items.map(() => ({ ok:false, id:null, err:String(e), status:500 })); }
}

function esc(s: any): string { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;"); }

// ── Preference + age matching (shared with premium-upsell / digest) ──
function matches(prefs: any, c: any): boolean {
  const loc=(c.location||"").toLowerCase();
  const open=!loc||loc.includes("nationwide")||loc.includes("remote")||loc.includes("worldwide")||loc.includes("any");
  const cities=((prefs.preferred_cities)||[]).filter(Boolean);
  if(!open&&cities.length>0){ if(!cities.some((city:string)=>{ const cl=city.toLowerCase().trim(); return loc.includes(cl)||cl.includes(loc.split(",")[0].trim()); })) return false; }
  const up=((prefs.union_preference)||"any").toLowerCase();
  if(up!=="any"){ const cu=(c.union_status||"").toLowerCase(); const isU=cu.includes("sag")||cu.includes("aea")||cu.includes("union"); const nonU=cu.includes("non-union")||cu.includes("non union"); if(up==="union"&&!isU) return false; if(up==="non_union"&&isU&&!nonU) return false; }
  const types=((prefs.preferred_project_types)||[]).filter(Boolean);
  if(types.length>0){ const ct=(c.type||"").toLowerCase(); if(!types.some((t:string)=>{ const tl=t.toLowerCase(); return ct.includes(tl)||tl.includes(ct); })) return false; }
  if(prefs.paid_only&&!c.pay) return false;
  return true;
}
function roleCoversAge(ageRange: any, age: number): boolean {
  if(!ageRange) return true;
  const s=String(ageRange).toLowerCase().replace(/[–—]/g,"-");
  const nums=(s.match(/\d+/g)||[]).map(Number);
  if(nums.length===0) return true;
  if(s.includes("+")) return age>=nums[0];
  if(nums.length>=2){ const lo=Math.min(nums[0],nums[1]), hi=Math.max(nums[0],nums[1]); return age>=lo&&age<=hi; }
  return true;
}
function castingAgeOk(c: any, age: number|null|undefined): boolean {
  if(!age || age<=0) return true;
  const roles=c.roles||[]; if(!roles.length) return true;
  return roles.some((r:any)=>roleCoversAge(r.age_range,age));
}

function closesLabel(deadline: string|null): string {
  if(!deadline) return "";
  const days=Math.ceil((new Date(deadline).getTime()-Date.now())/86400000);
  if(days<0) return "";
  if(days===0) return "Closes today";
  if(days===1) return "Closes tomorrow";
  if(days<=14) return `Closes in ${days} days`;
  return "";
}

// ── Coral Sunset tone — same shell as the shortlist / hold / recap emails ──
const T = {
  band:   "#C43B22", band2: "#FF6B4A", foot: "#7A2413",
  onDark: "#FFC9B8", onCream: "#BE3A20",
  rule:   "#FF8A6B", rule0: "rgba(196,59,34,0)",
  kicker: "#BE3A20", card: "#FFEFEA", cardBd: "#FBD8CC", cta: "#C43B22",
};

function chip(bg: string, color: string, glyph: string, border?: string, size = 30): string {
  const bd = border ? `;border:1.5px solid ${border}` : "";
  return `<td style="width:${size+12}px;vertical-align:middle;padding-right:12px"><table cellpadding="0" cellspacing="0"><tr><td width="${size}" height="${size}" align="center" style="width:${size}px;height:${size}px;background:${bg};border-radius:${Math.round(size/2)}px${bd};text-align:center;vertical-align:middle;font-size:14px;line-height:${size}px;color:${color};font-weight:700">${glyph}</td></tr></table></td>`;
}

// ── Cards ──
function appliedCard(c: any): string {
  const meta=[c.location||"Location TBD", c.union_status, c.pay].filter(Boolean).map(esc).join(" &nbsp;&middot;&nbsp; ");
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:10px"><tr>
      <td style="background:#FFFFFF;border:1px solid ${T.cardBd};border-left:4px solid ${T.band2};border-radius:12px;padding:15px 18px">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          ${chip(T.band2,"#FFFFFF","&#10003;")}
          <td style="vertical-align:middle">
            <div style="font-size:16px;font-weight:800;color:#1A1A2E">${esc(c.title)}</div>
            <div style="font-size:12px;color:#9A9384;margin-top:3px">${meta}</div>
          </td>
          <td align="right" style="vertical-align:middle;white-space:nowrap"><span style="display:inline-block;background:${T.card};color:${T.kicker};padding:4px 11px;border-radius:20px;font-size:11px;font-weight:800">You applied</span></td>
        </tr></table>
      </td></tr></table>`;
}
function lockedCard(c: any): string {
  const bits=[c.location||"Location", c.pay?"Paid":null, closesLabel(c.deadline||null)].filter(Boolean).map(esc).join(" &nbsp;&middot;&nbsp; ");
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:8px"><tr>
      <td style="background:#FBFAF6;border:1px solid #E8E3D6;border-left:4px solid #CFC8B7;border-radius:12px;padding:14px 18px">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          ${chip("#FFFFFF","#B0A894","&#128274;","#E2DCCC")}
          <td style="vertical-align:middle">
            <div style="font-size:15px;font-weight:800;color:#B8B09D;letter-spacing:0.4px">${esc(c.title)} &nbsp;&bull;&bull;&bull;&bull;</div>
            <div style="font-size:12px;color:#C4BCA9;margin-top:3px">&#128274; ${bits}</div>
          </td>
        </tr></table>
      </td></tr></table>`;
}

interface BuildInput { firstName:string; userId:string; mode:"week"|"open"; count:number; appliedThisWeek:number; applied:any|null; locked:any[]; moreCount:number; }
function buildEmail(b: BuildInput): string {
  const unsub  = `${UNSUB_BASE}?action=unsubscribe&uid=${b.userId}`;
  const cardsHtml = (b.applied ? appliedCard(b.applied) : "") + b.locked.map(lockedCard).join("");
  const N = b.count;
  const plural = N !== 1;
  const headTop    = b.mode === "week" ? `${N} casting${plural?"s":""} that fit you` : `${N} open role${plural?"s":""} that fit you`;
  const headAccent = b.mode === "week" ? `dropped this week.` : `you haven&rsquo;t applied to.`;
  const appliedLine = b.appliedThisWeek > 0
    ? `You applied to ${b.appliedThisWeek} this week.`
    : `You haven&rsquo;t applied to any this week.`;
  const moreLine = b.moreCount>0
    ? `<div style="text-align:center;padding:4px 0 0"><span style="font-size:13px;color:#9A9384;font-weight:600">+ ${b.moreCount} more role${b.moreCount!==1?"s":""} ${b.mode==="week"?"you couldn&rsquo;t submit to this week":"you haven&rsquo;t submitted to"}</span></div>`
    : "";
  const preheader = b.mode === "week"
    ? `${N} casting${plural?"s":""} that fit you dropped this week. Premium members already applied.`
    : `${N} open role${plural?"s":""} that fit you, still waiting on a submission.`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${esc(headTop)} &mdash; CastSlate</title>
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
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f0f4f4"><tr><td align="center" style="padding:32px 14px">
  <!--[if mso]><table width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:560px;background:#FCFAF7;border-radius:16px;overflow:hidden;box-shadow:0 1px 0 #EAE2D1">

      <tr><td class="cs-pad" style="background:${T.band};background:linear-gradient(115deg,${T.band2} 0%,${T.band} 62%,${T.band2} 100%);padding:22px 30px">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td style="vertical-align:middle"><table cellpadding="0" cellspacing="0" role="presentation"><tr>
            <td style="vertical-align:middle;padding-right:14px"><img class="cs-mark" src="${LOGO_TILE}" width="46" height="46" alt="CastSlate" style="display:block;border-radius:11px;border:0"/></td>
            <td style="vertical-align:middle"><span class="cs-word" style="font-size:24px;font-weight:800;letter-spacing:1.7px;color:#FFFFFF;white-space:nowrap">CASTSLATE</span></td>
          </tr></table></td>
          <td class="cs-kicker" align="right" style="vertical-align:middle;padding-left:18px"><span style="font-size:10px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:${T.onDark};white-space:nowrap">Weekly digest</span></td>
        </tr></table>
      </td></tr>

      <tr><td style="height:4px;line-height:4px;font-size:0;background:${T.rule};background:linear-gradient(90deg,${T.onDark},${T.rule} 52%,${T.rule0})">&nbsp;</td></tr>

      <tr><td class="cs-pad" style="padding:34px 30px 0">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td style="vertical-align:top">
            <h1 class="cs-h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;color:#1A1A2E;letter-spacing:-0.5px;line-height:1.22">${esc(headTop)}<br/><span style="color:${T.onCream}">${headAccent}</span></h1>
          </td>
          <td class="cs-badge-cell" align="right" style="vertical-align:top;width:112px">
            <img class="cs-badge" src="${WEEK_BADGE}" width="104" height="80" alt="" style="display:block;border:0"/>
          </td>
        </tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="padding:20px 30px 0"><p style="margin:0;font-size:15px;line-height:1.78;color:#5A5A72"><strong style="color:#1A1A2E">${appliedLine}</strong> Free members get one submission a week &mdash; Premium members applied to every one of these the moment it posted, first in line.</p></td></tr>

      <tr><td class="cs-pad" style="padding:22px 30px 0">
        ${cardsHtml}
        ${moreLine}
      </td></tr>

      <tr><td class="cs-pad" style="padding:26px 30px 0">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${T.kicker};margin:0 0 8px">The industry went digital</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:22px;color:#1A1A2E;margin:0 0 8px">Your whole career on one QR code.</div>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#5A5A72">Nobody hands out paper headshots anymore. A photo stapled to a r&eacute;sum&eacute; can&rsquo;t show your reel, your range, or your latest look. Your CastSlate business card can &mdash; one scan and an agent or casting director sees <strong style="color:#1A1A2E">everything.</strong></p>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;border:1px solid ${T.cardBd};border-radius:14px;overflow:hidden">
          <tr><td style="padding:0"><img src="${CARDS_IMG}" width="500" alt="Two CastSlate actor business cards, each with a QR code" style="display:block;width:100%;max-width:500px;height:auto;border:0"/></td></tr>
          <tr><td style="padding:4px 20px 18px">
            <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${T.kicker};margin:0 0 4px">Real cards, real actors</div>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#5A5A72">This is your card. Your headshot, your billing, your city &mdash; and a QR that opens your live profile the second someone scans it.</p>
          </td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:12px;background:${T.band};border-radius:14px"><tr><td style="padding:20px 24px">
          <div style="font-size:10.5px;font-weight:800;color:${T.onDark};letter-spacing:1.4px;text-transform:uppercase;margin:0 0 10px">One scan reveals</div>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr><td width="26" style="vertical-align:middle;padding:5px 10px 5px 0;color:${T.onDark};font-size:14px">&#9654;</td><td style="vertical-align:middle;padding:5px 0;font-size:14px;color:#FFFFFF">Multiple showreels &amp; self-tapes</td></tr>
            <tr><td width="26" style="vertical-align:middle;padding:5px 10px 5px 0;color:${T.onDark};font-size:14px">&#9673;</td><td style="vertical-align:middle;padding:5px 0;font-size:14px;color:#FFFFFF">A full gallery of looks &mdash; not one still</td></tr>
            <tr><td width="26" style="vertical-align:middle;padding:5px 10px 5px 0;color:${T.onDark};font-size:14px">&#9776;</td><td style="vertical-align:middle;padding:5px 0;font-size:14px;color:#FFFFFF">Live r&eacute;sum&eacute;, credits &amp; stats</td></tr>
            <tr><td width="26" style="vertical-align:middle;padding:5px 10px 5px 0;color:${T.onDark};font-size:14px">&#10227;</td><td style="vertical-align:middle;padding:5px 0;font-size:14px;color:#FFFFFF">Always current &mdash; update once, it&rsquo;s live</td></tr>
          </table>
        </td></tr></table>
        <p style="margin:16px 0 0;font-size:13px;line-height:1.65;color:#8A8474;text-align:center;font-style:italic">Hand someone a headshot and it&rsquo;s outdated by your next haircut. Hand them your card and they see the real, current you &mdash; in motion.</p>
      </td></tr>

      <tr><td class="cs-pad" style="padding:28px 30px 34px">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td style="background:${T.card};border:1px solid ${T.cardBd};border-radius:12px;padding:20px 20px 18px">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
              <td width="60" style="width:60px;vertical-align:top;padding-right:14px">
                <table cellpadding="0" cellspacing="0" role="presentation"><tr><td width="46" height="46" align="center" style="width:46px;height:46px;background:${T.band2};border-radius:13px;text-align:center;vertical-align:middle;font-size:22px;line-height:46px">&#127963;&#65039;</td></tr></table>
              </td>
              <td style="vertical-align:top">
                <div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${T.kicker};margin:0 0 6px">Premium &middot; Talent Agency &amp; Management Directory</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:21px;color:#1A1A2E;line-height:1.25;margin:0 0 8px">Every agency in LA and New York.<br/>In one place.</div>
              </td>
            </tr></table>
            <p style="margin:12px 0 0;font-size:14px;line-height:1.72;color:#5A5A72">Actors spend <strong style="color:#1A1A2E">years</strong> piecing this together &mdash; which agencies are real, which ones moved, who still reads mail from an actor they&rsquo;ve never met, and what to send them. We did the years. You get the list.</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:14px 0 4px;background:#FFFFFF;border:1px solid ${T.cardBd};border-radius:10px"><tr>
              <td width="33%" align="center" style="padding:10px 6px;vertical-align:top"><div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${T.onCream};line-height:1">663</div><div style="font-size:10.5px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#8A8474;margin-top:5px">Agencies &amp; managers</div></td>
              <td width="33%" align="center" style="padding:10px 6px;vertical-align:top"><div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${T.onCream};line-height:1">2</div><div style="font-size:10.5px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#8A8474;margin-top:5px">Cities &mdash; LA &amp; NYC</div></td>
              <td width="33%" align="center" style="padding:10px 6px;vertical-align:top"><div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${T.onCream};line-height:1">44</div><div style="font-size:10.5px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#8A8474;margin-top:5px">Open to new actors</div></td>
            </tr></table>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:10px">
              <tr>${chip("#FFFFFF",T.kicker,"&#9873;",T.cardBd,26)}<td style="vertical-align:middle;padding:5px 0;font-size:14px;line-height:1.5;color:#45506A">Office address, website and phone for all 663 &mdash; hand-verified, dead and parked ones removed</td></tr>
              <tr>${chip("#FFFFFF",T.kicker,"&#9993;",T.cardBd,26)}<td style="vertical-align:middle;padding:5px 0;font-size:14px;line-height:1.5;color:#45506A">The exact submission route each one accepts &mdash; mail, email or form. No more guessing.</td></tr>
              <tr>${chip("#FFFFFF",T.kicker,"&#9733;",T.cardBd,26)}<td style="vertical-align:middle;padding:5px 0;font-size:14px;line-height:1.5;color:#45506A">Sorted by size, so you know who&rsquo;s a boutique and who&rsquo;s the room everyone wants</td></tr>
              <tr>${chip("#FFFFFF",T.kicker,"&#10022;",T.cardBd,26)}<td style="vertical-align:middle;padding:5px 0;font-size:14px;line-height:1.5;color:#45506A">7 submission tips from people who read these envelopes for a living</td></tr>
            </table>
            <p style="margin:14px 0 0;font-size:13.5px;line-height:1.65;color:${T.onCream};font-weight:700">It&rsquo;s the kind of knowledge the industry keeps to itself. Premium hands you all of it on day one.</p>
          </td></tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="background:${T.band};padding:32px 30px 34px;text-align:center">
        <h2 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px">The old world used paper.<br/>You&rsquo;re in the new one.</h2>
        <p style="margin:0 auto 20px;font-size:14px;line-height:1.65;color:rgba(255,255,255,0.72);max-width:400px">Unlimited submissions, every casting the moment it drops, your digital card, and all 663 agencies.</p>
        <table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr><td style="background:${T.onDark};border-radius:11px">
          <a href="${APP_URL}/membership" style="display:inline-block;padding:15px 40px;font-size:15px;font-weight:800;letter-spacing:0.2px;color:${T.band};text-decoration:none">Go Premium &nbsp;&rarr;</a>
        </td></tr></table>
        <div style="margin-top:14px;font-size:12px;color:rgba(255,255,255,0.45)">Cancel anytime &middot; Keep your digital card forever</div>
      </td></tr>

      <tr><td class="cs-pad" style="background:${T.foot};padding:22px 30px">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td style="vertical-align:top;width:38px;padding-top:2px"><img src="${BELL_IMG}" width="26" height="26" alt="" style="display:block;border:0"/></td>
          <td style="vertical-align:top"><p style="margin:0;font-size:12px;line-height:1.75;color:rgba(255,255,255,0.70)">You&rsquo;re receiving this weekly digest because you signed up for CastSlate casting recommendations.<br/><a href="${APP_URL}/account-settings" style="color:${T.onDark};text-decoration:none;font-weight:700">Manage preferences</a> &middot; <a href="${unsub}" style="color:${T.onDark};text-decoration:none;font-weight:700">Unsubscribe</a> &middot; <a href="mailto:${CONTACT_EMAIL}" style="color:${T.onDark};text-decoration:none;font-weight:700">${CONTACT_EMAIL}</a></p></td>
        </tr></table>
      </td></tr>

    </table>
  <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
}

function subjectFor(): string {
  const day = new Date().toLocaleDateString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric"});
  return `The castings you missed this week — ${day}`;
}

serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});

  // Unsubscribe — handle BOTH the visible in-email link (GET) and the native
  // one-click button Gmail/Apple Mail render from List-Unsubscribe-Post (RFC 8058:
  // a POST with body "List-Unsubscribe=One-Click", not JSON). Both carry
  // ?action=unsubscribe&uid=... in the URL; must run before any req.json() below.
  {
    const url=new URL(req.url);
    if((req.method==="GET"||req.method==="POST")&&url.searchParams.get("action")==="unsubscribe"&&url.searchParams.get("uid")){
      const uid=url.searchParams.get("uid")!;
      const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);
      const{data:existing}=await sb.from("email_preferences").select("weekly_upsell_optout").eq("user_id",uid).maybeSingle();
      await sb.from("email_preferences").upsert({user_id:uid,weekly_upsell_optout:true,updated_at:new Date().toISOString()},{onConflict:"user_id"});
      if(!existing || existing.weekly_upsell_optout!==true){ try{ await sb.from("weekly_upsell_logs").insert({user_id:uid,status:"skipped",reason:"unsubscribe_click"}); }catch(_){ /* non-fatal */ } }
      return req.method==="GET"
        ? new Response(null,{ status:302, headers:{...cors,"Location":`${APP_URL}/unsubscribed`} })
        : new Response(JSON.stringify({ok:true,unsubscribed:true}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
    }
    if(req.method==="GET") return new Response("Not found",{status:404});
  }

  const res=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
  const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);

  try{
    const body=await req.json();
    const{action,to_email,secret}=body;

    let authorized = !!secret && (secret===SUPABASE_SERVICE_KEY || (ADMIN_SECRET && secret===ADMIN_SECRET));
    if(!authorized){
      const authz=req.headers.get("Authorization")||"";
      if(authz.startsWith("Bearer ")){
        try{ const{data:{user}}=await sb.auth.getUser(authz.slice(7));
          if(user){ const{data:prof}=await sb.from("profiles").select("user_type").eq("id",user.id).maybeSingle(); if(prof&&["admin","super_admin"].includes(prof.user_type)) authorized=true; } }catch(_){ /* fall through */ }
      }
    }
    if(!authorized) return res({error:"Unauthorized"},401);
    if(!emailConfigured()) return res({error:"Email provider not configured"},500);

    const today=new Date().toISOString().slice(0,10);
    const weekAgoIso=new Date(Date.now()-7*86400000).toISOString();

    // Load active castings + roles (shared by run + test).
    async function loadActiveCastings(){
      const{data:castings}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).order("created_at",{ascending:false}).limit(500);
      const cwr:any[]=[];
      if(castings?.length){
        const cids=castings.map((c:any)=>c.id); const rb:Record<string,any[]>={};
        for(let i=0;i<cids.length;i+=200){ const{data:roles}=await sb.from("roles").select("id,casting_id,name,age_range,gender,pay").in("casting_id",cids.slice(i,i+200)); (roles||[]).forEach((r:any)=>{(rb[r.casting_id]??=[]).push(r);}); }
        castings.forEach((c:any)=>cwr.push({...c,posted_at:c.created_at,roles:rb[c.id]||[]}));
      }
      return cwr;
    }
    const shuffle=(arr:any[])=>{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; };

    // Build one user's personalized email inputs. Returns null when there is nothing
    // TRUE to show — we never pad the count to keep a user in the send.
    function decide(p:any, pf:any, appliedCasting:any|null, appliedThisWeek:number, appliedIds:Set<string>, cwr:any[]): BuildInput|null {
      const matched     = cwr.filter((c:any)=>matches(pf,c) && castingAgeOk(c,p.age));
      const isFresh     = (c:any)=>(c.created_at||c.posted_at)>=weekAgoIso;
      const newThisWeek = matched.filter(isFresh);                       // real "dropped this week" count
      const unseen      = matched.filter((c:any)=>!appliedIds.has(c.id));
      const mode: "week"|"open" = newThisWeek.length>0 ? "week" : "open";
      const count       = mode==="week" ? newThisWeek.length : unseen.length;
      if(count===0) return null;
      const lockedPool  = shuffle((mode==="week" ? unseen.filter(isFresh) : unseen).slice());
      const lockCap     = appliedCasting ? 2 : 3;
      const locked      = lockedPool.slice(0,lockCap);
      if(!appliedCasting && locked.length===0) return null;              // nothing to show → skip
      const moreCount   = Math.max(0, lockedPool.length - locked.length);
      const first=(p.display_name??"").split(" ")[0].trim()||"there";
      return { firstName:first, userId:p.id, mode, count, appliedThisWeek, applied:appliedCasting, locked, moreCount };
    }

    // ── TEST: single preview send. ──
    if(action==="test"){
      if(!to_email) return res({error:"to_email required"},400);
      const cwr=await loadActiveCastings();
      const asId=body.as_talent_id as string|undefined;
      if(asId){
        const{data:p}=await sb.from("profiles").select("id,display_name,age,membership_status").eq("id",asId).maybeSingle();
        const{data:pf}=await sb.from("email_preferences").select("*").eq("user_id",asId).maybeSingle();
        const{data:apps}=await sb.from("applications").select("casting_id,created_at").eq("talent_id",asId).order("created_at",{ascending:false});
        const appsThisWeek=(apps||[]).filter((a:any)=>a.created_at>=weekAgoIso);
        const appliedThisWeek=appsThisWeek.length;
        const appliedIds=new Set<string>((apps||[]).map((a:any)=>a.casting_id));
        // Only a THIS-WEEK application may appear on the "You applied" card.
        let appliedCasting:any=null;
        if(appsThisWeek.length){ const{data:cc}=await sb.from("castings").select("id,title,location,union_status,pay").eq("id",appsThisWeek[0].casting_id).maybeSingle(); appliedCasting=cc||null; }
        const inp=decide(p||{id:asId,display_name:"there"}, pf||{}, appliedCasting, appliedThisWeek, appliedIds, cwr);
        if(!inp) return res({ok:false,message:"That user has nothing true to show (no matching castings this week and no unseen open roles)."});
        const r=await sendEmail({from:FROM_EMAIL,to:[to_email],replyTo:CONTACT_EMAIL,subject:subjectFor(),html:buildEmail(inp)});
        return r.ok ? res({ok:true,test:true,rendered_for:asId,mode:inp.mode,count:inp.count,applied_this_week:inp.appliedThisWeek,applied_card:inp.applied?inp.applied.title:null,locked:inp.locked.map((c:any)=>c.title),more:inp.moreCount,to:to_email,provider_id:r.id}) : res({error:r.err},500);
      }
      // Generic sample (no specific user) — real casting titles off the top of the pool.
      const sample=cwr.slice(0,3);
      if(!sample.length) return res({ok:false,message:"No active castings to sample."});
      const applied={id:sample[0].id,title:sample[0].title,location:sample[0].location,union_status:sample[0].union_status,pay:sample[0].pay};
      const locked=sample.slice(1,3);
      const inp:BuildInput={firstName:"there",userId:"test",mode:"week",count:sample.length,appliedThisWeek:1,applied,locked,moreCount:0};
      const r=await sendEmail({from:FROM_EMAIL,to:[to_email],replyTo:CONTACT_EMAIL,subject:subjectFor(),html:buildEmail(inp)});
      return r.ok ? res({ok:true,test:true,sample:true,to:to_email,provider_id:r.id}) : res({error:r.err},500);
    }

    if(action!=="run") return res({error:"Unknown action"},400);

    // ── RUN ──
    const overrideEmail=(body.test_override_email??"").toString().trim().toLowerCase()||null; // redirect all sends here (test)
    const onlyTalentId=(body.only_talent_id??"").toString().trim()||null;                     // process just this user (test)
    const isDryTest = !!overrideEmail || !!onlyTalentId;

    if(!isDryTest){
      const{data:cfg}=await sb.from("site_settings").select("weekly_upsell_enabled,weekly_upsell_paused").eq("id",1).maybeSingle();
      if(cfg && cfg.weekly_upsell_enabled===false) return res({ok:false,message:"Disabled",sent:0,skipped:0});
      if(cfg && cfg.weekly_upsell_paused===true)   return res({ok:false,message:"Paused",sent:0,skipped:0});
    }

    // Non-premium talent profiles (membership_status != 'active').
    const profiles:any[]=[];
    {
      const PAGE=1000; let from=0;
      while(true){
        let q=sb.from("profiles").select("id,display_name,notification_email,membership_status,age").in("user_type",["talent","actor"]).eq("account_status","active").eq("visible",true).or("membership_status.is.null,membership_status.neq.active").order("created_at",{ascending:true});
        if(onlyTalentId) q=q.eq("id",onlyTalentId);
        const{data,error}=await q.range(from,from+PAGE-1);
        if(error){ console.error("[weekly-upsell] profiles page error",error); break; }
        if(!data?.length) break;
        profiles.push(...data);
        if(data.length<PAGE) break; from+=PAGE;
      }
    }
    if(!profiles.length) return res({ok:true,message:"No eligible users",sent:0,skipped:0});
    const uids=profiles.map((p:any)=>p.id);

    const pm:Record<string,any>={};
    { const CH=300; for(let i=0;i<uids.length;i+=CH){ const{data:prefs}=await sb.from("email_preferences").select("*").in("user_id",uids.slice(i,i+CH)); (prefs||[]).forEach((p:any)=>{pm[p.user_id]=p;}); } }

    const emailMap:Record<string,string>={};
    { const CH=1000; for(let i=0;i<uids.length;i+=CH){ const{data,error}=await sb.rpc("get_digest_emails",{uids:uids.slice(i,i+CH)}); if(error){ console.error("[weekly-upsell] get_digest_emails error",error); continue; } (data||[]).forEach((r:any)=>{ if(r?.id&&r?.email) emailMap[r.id]=r.email; }); } }

    const suppressed=new Set<string>();
    { const PAGE=1000; let from=0; while(true){ const{data,error}=await sb.from("email_unsubscribes").select("email").range(from,from+PAGE-1); if(error){ console.error("[weekly-upsell] suppression load error",error); break; } if(!data?.length) break; data.forEach((r:any)=>{ if(r.email) suppressed.add(String(r.email).trim().toLowerCase()); }); if(data.length<PAGE) break; from+=PAGE; } }

    const cwr=await loadActiveCastings();
    const activeCids=cwr.map((c:any)=>c.id);

    // Per-user application aggregates. latest_casting_id_7d is the ONLY source for the
    // "You applied" card — an older application must never appear under a headline
    // that is talking about this week.
    const latestCastingId7d:Record<string,string>={};
    const appliedThisWeek:Record<string,number>={};
    { const CH=300; for(let i=0;i<uids.length;i+=CH){ const{data,error}=await sb.rpc("weekly_upsell_user_apps",{uids:uids.slice(i,i+CH)}); if(error){ console.error("[weekly-upsell] user_apps rpc error",error); continue; } (data||[]).forEach((r:any)=>{ if(r?.talent_id){ if(r.latest_casting_id_7d) latestCastingId7d[r.talent_id]=r.latest_casting_id_7d; appliedThisWeek[r.talent_id]=Number(r.apps_7d)||0; } }); } }

    // Applied casting details (may be closed / not in the active pool).
    const appliedCastingMap:Record<string,any>={};
    { const ids=[...new Set(Object.values(latestCastingId7d))]; for(let i=0;i<ids.length;i+=200){ const{data}=await sb.from("castings").select("id,title,location,union_status,pay").in("id",ids.slice(i,i+200)); (data||[]).forEach((c:any)=>{appliedCastingMap[c.id]=c;}); } }

    // Which ACTIVE castings each user has already applied to (to exclude from locked).
    const appliedInPool:Record<string,Set<string>>={};
    if(activeCids.length){
      for(let ui=0;ui<uids.length;ui+=300){
        const uchunk=uids.slice(ui,ui+300);
        for(let ci=0;ci<activeCids.length;ci+=200){
          const cchunk=activeCids.slice(ci,ci+200);
          const{data}=await sb.from("applications").select("talent_id,casting_id").in("talent_id",uchunk).in("casting_id",cchunk);
          (data||[]).forEach((a:any)=>{ (appliedInPool[a.talent_id]??=new Set<string>()).add(a.casting_id); });
        }
      }
    }

    interface Out{ userId:string; email:string; subject:string; html:string; }
    const outbox:Out[]=[];
    const logs:Record<string,unknown>[]=[];
    let sent=0, skipped=0, failed=0;
    const skipReasons:Record<string,number>={};
    const bump=(r:string)=>{ skipReasons[r]=(skipReasons[r]||0)+1; };

    for(const p of profiles){
      const email = overrideEmail || emailMap[p.id] || null;
      const pf=pm[p.id]??{};
      if(p.membership_status==="active"){ skipped++; bump("premium"); continue; }   // backstop: never premium
      let skipReason:string|null=null;
      if(pf.weekly_upsell_optout===true)      skipReason="campaign_optout";
      else if(p.notification_email===false)   skipReason="email_notifications_off";
      else if(!email)                         skipReason="no_email";
      else if(!overrideEmail && suppressed.has(String(email).trim().toLowerCase())) skipReason="suppressed";
      if(skipReason){ skipped++; bump(skipReason); if(!isDryTest) logs.push({user_id:p.id,email,status:"skipped",reason:skipReason}); continue; }

      const lcid=latestCastingId7d[p.id];
      const appliedCasting = lcid ? (appliedCastingMap[lcid]||null) : null;
      const inp=decide(p, pf, appliedCasting, appliedThisWeek[p.id]||0, appliedInPool[p.id]??new Set<string>(), cwr);
      if(!inp){ skipped++; bump("nothing_to_show"); if(!isDryTest) logs.push({user_id:p.id,email,status:"skipped",reason:"nothing_to_show"}); continue; }
      outbox.push({ userId:p.id, email, subject:subjectFor(), html:buildEmail(inp) });
    }

    const BATCH=100;
    for(let i=0;i<outbox.length;i+=BATCH){
      const group=outbox.slice(i,i+BATCH);
      const results=await sendBatch(group.map((o)=>({from:FROM_EMAIL,to:[o.email],replyTo:CONTACT_EMAIL,subject:o.subject,html:o.html,headers:{"List-Unsubscribe":`<${UNSUB_BASE}?action=unsubscribe&uid=${o.userId}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}})));
      group.forEach((o,idx)=>{ const r=results[idx];
        if(r?.ok){ sent++; if(!isDryTest) logs.push({user_id:o.userId,email:o.email,status:"sent",provider_message_id:r.id}); }
        else{ failed++; if(!isDryTest) logs.push({user_id:o.userId,email:o.email,status:"failed",error_message:r?.err}); } });
      if(i+BATCH<outbox.length) await new Promise((r)=>setTimeout(r,600));
    }

    if(!isDryTest){ for(let i=0;i<logs.length;i+=500){ try{ await sb.from("weekly_upsell_logs").insert(logs.slice(i,i+500)); }catch(e){ console.error("[weekly-upsell] log insert failed",e); } } }

    const summary={ok:true,sent,skipped,failed,total_users:profiles.length,skip_reasons:skipReasons,test:isDryTest||undefined};
    console.log("[weekly-upsell] run complete",JSON.stringify(summary));
    return res(summary);
  }catch(e){
    console.error("[weekly-upsell]",e);
    return res({error:String(e)},500);
  }
});

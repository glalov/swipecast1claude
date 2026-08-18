// premium-upsell — Supabase Edge Function
// A recurring "castings + go Premium" campaign for NON-PREMIUM talent only.
//
// POST { action:"run", slot:"noon"|"evening" }  → send to every eligible free user.
// POST { action:"test", to_email, slot? }        → preview send to one address.
// GET  ?action=unsubscribe&uid=<id>              → opt out of THIS campaign only.
//
// Design decisions (why this is safe to run twice a day):
//   • Recipients are resolved AT SEND TIME as talent/actor profiles whose
//     membership_status is NOT 'active'. The moment a user upgrades to Premium
//     their row flips to 'active' and they are excluded automatically — there is
//     no static list to maintain, so upgraders stop receiving it instantly.
//   • Premium users are NEVER emailed: the recipient query excludes them, and a
//     second in-loop guard drops anyone whose status is 'active' as a backstop.
//   • Unsubscribing here sets email_preferences.premium_upsell_optout = true — a
//     DEDICATED opt-out, so leaving this campaign does NOT stop their casting
//     digest (which uses casting_digest_enabled / unsubscribed_at).
//   • Hard-bounced / complained addresses (email_unsubscribes, populated by
//     resend-webhook) are always suppressed — never re-mailed.
//   • The on/off toggle lives in site_settings.premium_upsell_enabled (+ a
//     premium_upsell_paused emergency stop). When off, run() sends nothing.
//   • Every send is logged to premium_upsell_logs with the slot (noon|evening)
//     so the admin panel can show noon vs evening stats separately.
//   • Sends go out via Resend's batch endpoint (100/call) — same scaling approach
//     as the daily digest, keeping the run under the Edge Function wall clock.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/premium-upsell`;

// Auth: service-role key or the shared admin campaign secret (mirrors send-campaign).
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "cmpn_9e872b254fab6297129ac7ee95c021831a2163dd1f7a9906";

// ── Email provider — Resend (pinned, like the digest). ──
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, GET, OPTIONS",
};

function emailConfigured(): boolean { return !!RESEND_API_KEY; }

interface SendEmailArgs { from:string; to:string[]; subject:string; html:string; text?:string; replyTo?:string; headers?:Record<string,string>; }
interface SendEmailResult { ok:boolean; id:string|null; err:string|null; status:number; }

async function sendEmail(a: SendEmailArgs): Promise<SendEmailResult> {
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

// Batch send via Resend (up to 100 messages/call). Results come back in input order.
async function sendBatch(items: SendEmailArgs[]): Promise<SendEmailResult[]> {
  if (!RESEND_API_KEY) return items.map(()=>({ ok:false, id:null, err:"RESEND_API_KEY not set", status:500 }));
  // deno-lint-ignore no-explicit-any
  const payload = items.map((a) => {
    const o:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
    if (a.replyTo) o.reply_to = a.replyTo;
    if (a.headers) o.headers = a.headers;
    return o;
  });
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method:"POST",
      headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" },
      body:JSON.stringify(payload),
    });
    if (r.ok) {
      const d = await r.json().catch(()=>({}));
      // deno-lint-ignore no-explicit-any
      const arr:any[] = Array.isArray((d as any)?.data) ? (d as any).data : [];
      return items.map((_, i) => ({ ok:true, id: arr[i]?.id ?? null, err:null, status:r.status }));
    }
    const errText = await r.text();
    return items.map(() => ({ ok:false, id:null, err:errText, status:r.status }));
  } catch (e) {
    return items.map(() => ({ ok:false, id:null, err:String(e), status:500 }));
  }
}

// ── Casting helpers (mirrors process-digest-queue) ──
// (No "posted N days ago" stamp on the cards — removed by request. Recency is
// enforced by the RECENT_POOL window below rather than shown as a date.)

function matches(prefs: any, c: any): boolean {
  const loc=(c.location||"").toLowerCase();
  const open=!loc||loc.includes("nationwide")||loc.includes("remote")||loc.includes("worldwide")||loc.includes("any");
  const cities=((prefs.preferred_cities)||[]).filter(Boolean);
  if(!open&&cities.length>0){
    if(!cities.some((city:string)=>{ const cl=city.toLowerCase().trim(); return loc.includes(cl)||cl.includes(loc.split(",")[0].trim()); })) return false;
  }
  const up=((prefs.union_preference)||"any").toLowerCase();
  if(up!=="any"){
    const cu=(c.union_status||"").toLowerCase();
    const isU=cu.includes("sag")||cu.includes("aea")||cu.includes("union");
    const nonU=cu.includes("non-union")||cu.includes("non union");
    if(up==="union"&&!isU) return false;
    if(up==="non_union"&&isU&&!nonU) return false;
  }
  const types=((prefs.preferred_project_types)||[]).filter(Boolean);
  if(types.length>0){
    const ct=(c.type||"").toLowerCase();
    if(!types.some((t:string)=>{ const tl=t.toLowerCase(); return ct.includes(tl)||tl.includes(ct); })) return false;
  }
  if(prefs.paid_only&&!c.pay) return false;
  return true;
}

// Age safety-filter. A casting is age-appropriate when the actor's age is unknown,
// the casting has no roles, or at least one role's age range covers the actor.
// Roles with no / "Any" / unparseable range count as covering — we only EXCLUDE a
// casting when every role has a real numeric range and none of them fit. This stops
// e.g. a 24-year-old receiving a casting whose roles are all 50+.
function roleCoversAge(ageRange: any, age: number): boolean {
  if(!ageRange) return true;
  const s=String(ageRange).toLowerCase().replace(/[–—]/g,"-");
  const nums=(s.match(/\d+/g)||[]).map(Number);
  if(nums.length===0) return true;               // "Any", "All ages", etc.
  if(s.includes("+")) return age>=nums[0];        // "18+", "All ages 18+"
  if(nums.length>=2){ const lo=Math.min(nums[0],nums[1]), hi=Math.max(nums[0],nums[1]); return age>=lo&&age<=hi; }
  return true;                                    // single loose number → be lenient
}
function castingAgeOk(c: any, age: number|null|undefined): boolean {
  if(!age || age<=0) return true;                 // no age on file → don't filter
  const roles=c.roles||[];
  if(!roles.length) return true;
  return roles.some((r:any)=>roleCoversAge(r.age_range,age));
}

// Casting card — the SAME white/indigo card the daily casting digest uses, so
// the two emails read as one family (requested). No posted-date stamp: recency
// is enforced by the RECENT_POOL window below, not shown to the reader.
function pill(text: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;background:${bg};color:${fg};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin:0 4px 4px 0;">${text}</span>`;
}

function card(c: any): string {
  const roles  = (c.roles||[]).slice(0,3);
  const more   = Math.max(0,(c.roles||[]).length-3);
  const link   = `${APP_URL}/casting/${c.slug}`;

  const typePill  = c.type         ? pill(String(c.type).toUpperCase(),"#f0f0ff","#4338ca") : "";
  const unionPill = c.union_status ? pill(c.union_status,"#f8fafc","#475569")               : "";
  const paidPill  = c.pay          ? pill("$ PAID","#f0fdf4","#15803d")                     : pill("DEFERRED","#fefce8","#854d0e");

  const rolesBlock = roles.length ? `
  <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin:10px 0 14px;border-top:1px solid #f1f5f9;">
    ${roles.map((r:any)=>{
      const p=[`<strong style="color:#0f172a;font-size:12px">${r.name||"Role"}</strong>`];
      if(r.age_range) p.push(`<span style="color:#64748b;font-size:12px">${r.age_range}</span>`);
      if(r.gender&&String(r.gender).toLowerCase()!=="any") p.push(`<span style="color:#64748b;font-size:12px">${r.gender}</span>`);
      if(r.pay) p.push(`<span style="color:#16a34a;font-size:12px;font-weight:600">${r.pay}</span>`);
      return `<tr><td style="padding:5px 0;border-bottom:1px solid #f8fafc;">${p.join(" <span style='color:#cbd5e1'>&middot;</span> ")}</td></tr>`;
    }).join("")}
    ${more>0?`<tr><td style="padding:4px 0;font-size:11px;color:#94a3b8;">+${more} more role${more>1?"s":""}</td></tr>`:""}
  </table>` : "";

  const synopsis = c.synopsis
    ? `<p style="margin:0 0 12px;font-size:13px;color:#64748b;line-height:1.65;">${String(c.synopsis).slice(0,200)}${String(c.synopsis).length>200?"&hellip;":""}</p>`
    : "";

  return `
<table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:12px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;background:#ffffff;">
<tr>
  <td style="width:3px;background:#4338ca;" width="3"></td>
  <td style="padding:16px 18px 16px 16px;">
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:8px;"><tr>
      <td style="vertical-align:top;">
        <div style="font-size:16px;font-weight:800;color:#0f172a;line-height:1.3;margin-bottom:4px;">${c.title}</div>
        <div style="font-size:12px;color:#94a3b8;">&#128205;&nbsp;${c.location||"Location TBD"}</div>
      </td>
    </tr></table>
    <div style="margin:6px 0 10px;">${typePill}${unionPill}${paidPill}</div>
    ${synopsis}
    ${rolesBlock}
    <a href="${link}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:700;letter-spacing:0.2px;">View Casting &rarr;</a>
  </td>
</tr>
</table>`;
}

// ── The email — film still on top, job cards, dark Premium spotlight (Version D). ──
interface Hero { image_url: string; caption: string; subject_hook: string; style: string; accent: string; title: string; year: number | null; }

function buildEmail(firstName: string, castings: any[], userId: string, slot: string, hero: Hero | null = null): string {
  const count      = castings.length;
  const cards      = castings.map(card).join("");
  const unsub      = `${UNSUB_BASE}?action=unsubscribe&uid=${userId}&slot=${slot}`;
  const browse     = `${APP_URL}/browse-castings`;
  const upgrade    = `${APP_URL}/membership`;
  const home       = APP_URL;
  const logoImgUrl = `${APP_URL}/email/castslate-logo.png`;
  const greetLead  = slot === "evening" ? "Before the day's out" : "Fresh for you today";
  const slotLabel  = slot === "evening" ? "Evening castings" : "Daily castings";

  const jobsSection = count ? `
<tr>
  <td class="cards-pad" style="background:#f8fafc;padding:20px 18px 8px;">${cards}</td>
</tr>
<tr>
  <td class="cta-pad" style="background:#f8fafc;padding:4px 28px 26px;text-align:center;">
    <a href="${browse}" style="display:inline-block;background:#37696A;color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:9px;font-size:14px;font-weight:700;letter-spacing:0.1px;border:2px solid #37696A;">Browse All Castings</a>
  </td>
</tr>` : `
<tr>
  <td class="cta-pad" style="background:#f8fafc;padding:20px 28px 26px;text-align:center;">
    <a href="${browse}" style="display:inline-block;background:#37696A;color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:9px;font-size:14px;font-weight:700;letter-spacing:0.1px;border:2px solid #37696A;">Browse Open Castings</a>
  </td>
</tr>`;

  const headline = count
    ? (count===1 ? "A fresh casting for you today" : `${count} fresh castings for you today`)
    : "New castings are waiting";
  const sub = count
    ? "Review them, then submit while the roles are still open — casting moves fast."
    : "New projects post every day. Take a look and submit to the ones that fit.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>${headline} &mdash; CastSlate</title>
<style>
@media only screen and (max-width:620px){
  .wrap{padding:0 !important;}
  .shell{border-radius:0 !important;}
  .hero-img{height:auto !important;}
  .head-pad{padding:10px 18px !important;}
  .body-pad{padding:22px 20px 18px !important;}
  .cards-pad{padding:16px 12px 6px !important;}
  .cta-pad{padding:4px 16px 22px !important;}
  .prem-pad{padding:34px 22px 30px !important;}
  .hl{font-size:21px !important;}
  .foot-pad{padding:18px 18px 22px !important;}
}
/* Motion — animates in Apple Mail / iOS Mail; other clients show the static design.
   The glow is baked into the section BACKGROUND (not a positioned layer) so it
   renders identically in Gmail/Outlook, which strip position. */
@keyframes cs_twinkle{0%,100%{opacity:0.4;}50%{opacity:1;}}
@keyframes cs_rule{0%,100%{opacity:0.55;}50%{opacity:1;}}
.cs-tw{animation:cs_twinkle 3s ease-in-out infinite;}
.cs-tw.d1{animation-delay:0.6s;}
.cs-rule{animation:cs_rule 4.5s ease-in-out infinite;}
@media (prefers-reduced-motion: reduce){.cs-tw,.cs-rule{animation:none !important;}}
</style>
</head>
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="wrap" style="background:#f0f4f4;padding:28px 16px;">
<tr><td align="center">

<table width="600" cellpadding="0" cellspacing="0" role="presentation" class="shell" style="background:#ffffff;max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.09);">

<!-- HEADER — the daily casting digest's dark nav bar, so noon/evening reads as
     the same family of email. Deliberately NOT a white banner card above the
     still: that pushed the image below the fold and buried it. -->
<tr>
  <td class="head-pad" style="background:#1a1b2e;padding:14px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td style="vertical-align:middle;">
        <a href="${home}" style="text-decoration:none;">
          <table cellpadding="0" cellspacing="0" role="presentation"><tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <img src="${logoImgUrl}" width="32" height="32" alt="CastSlate" style="display:block;border-radius:7px;border:none;outline:none;text-decoration:none;" />
            </td>
            <td style="vertical-align:middle;">
              <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;">CastSlate</span>
            </td>
          </tr></table>
        </a>
      </td>
      <td style="text-align:right;vertical-align:middle;">
        <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.4);letter-spacing:1.5px;text-transform:uppercase;">${slotLabel}</span>
      </td>
    </tr></table>
  </td>
</tr>
${hero ? `<tr><td style="padding:0;line-height:0;"><img src="${hero.image_url}" width="600" alt="Still from ${hero.title}" style="display:block;width:100%;max-width:600px;height:auto;border:none;outline:none;" /></td></tr>
<tr><td style="height:4px;background:${hero.accent};line-height:0;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:16px 28px 4px;background:#ffffff;"><div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#94a3b8;letter-spacing:.4px;margin-bottom:8px;">Still: <em>${hero.title}</em>${hero.year ? ` (${hero.year})` : ""}</div><div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.35;font-weight:700;color:#0f172a;">${hero.caption}</div></td></tr>` : ""}

<!-- STUDIO STRIP — A24 / Neon / Netflix (muted charcoal) on teal tint -->
<tr>
  <td style="background:#eef5f5;padding:16px 20px 14px;text-align:center;border-bottom:1px solid #dce9e9;border-top:1px solid #f0f3f3;">
    <div style="font-size:10px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:#6f9a9a;margin-bottom:8px;">Casting across every format</div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:23px;letter-spacing:-0.5px;"><span style="color:#0A0A0A;">A24</span> <span style="color:#b7c8c8;font-weight:400;">&middot;</span> <span style="color:#FF2D6F;">Neon</span> <span style="color:#b7c8c8;font-weight:400;">&middot;</span> <span style="color:#E50914;">Netflix</span></div>
  </td>
</tr>

<!-- GREETING -->
<tr>
  <td class="body-pad" style="background:#ffffff;padding:26px 28px 22px;text-align:center;border-bottom:1px solid #f1f5f9;">
    ${count?`<div style="display:inline-block;background:#eef2ff;color:#4338ca;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">${greetLead}</div>`:""}
    <h1 class="hl" style="margin:0 0 12px;font-size:24px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;line-height:1.25;">Hi ${firstName} &mdash; ${headline} &#127916;</h1>
    <p style="margin:0 auto;font-size:15px;line-height:1.75;color:#64748b;max-width:440px;">${sub}</p>
  </td>
</tr>

${jobsSection}

<!-- PREMIUM UPSELL — Petrol Noir cinematic marquee (glow baked into background) -->
<tr>
  <td class="prem-pad" style="padding:40px 34px 40px;border-top:3px solid #e2b73c;background:#0a1418;background:radial-gradient(ellipse 440px 300px at 50% -6%, rgba(240,207,122,0.30) 0%, rgba(226,183,60,0.08) 40%, rgba(10,20,24,0) 72%), radial-gradient(ellipse at 94% 112%, rgba(45,120,120,0.26) 0%, rgba(45,120,120,0) 54%), linear-gradient(160deg,#08151a 0%,#0c2024 52%,#0f2a2e 100%);">
    <div style="text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:5px;text-transform:uppercase;color:#e6c98a;margin-bottom:16px;"><span class="cs-tw">&#9733;</span> &nbsp;Now Showing&nbsp; <span class="cs-tw d1">&#9733;</span></div>
      <h2 style="margin:0 0 10px;font-size:29px;font-weight:800;color:#f4f8f7;letter-spacing:-0.5px;line-height:1.15;">CastSlate <span style="color:#f0cf7a;">Premium</span></h2>
      <div class="cs-rule" style="width:52px;height:2px;background:linear-gradient(90deg,transparent,#e2b73c,transparent);margin:0 auto 18px;font-size:0;line-height:0;">&nbsp;</div>
      <p style="margin:0 auto 26px;font-size:14.5px;line-height:1.7;color:#a7bcbd;max-width:410px;">Step into the version of your career where nothing holds you back.</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td style="padding:14px 4px;border-top:1px solid rgba(226,183,60,0.14);"><table width="100%" role="presentation"><tr><td width="30" valign="top" style="color:#e2b73c;font-size:16px;">&#10022;</td><td style="color:#eef4f3;font-size:15px;font-weight:600;">Unlimited submissions <span style="color:#8ba4a4;font-weight:400;">&mdash; apply to every role, no weekly cap</span></td></tr></table></td></tr>
      <tr><td style="padding:14px 4px;border-top:1px solid rgba(226,183,60,0.14);"><table width="100%" role="presentation"><tr><td width="30" valign="top" style="color:#e2b73c;font-size:16px;">&#10022;</td><td style="color:#eef4f3;font-size:15px;font-weight:600;">Manager Mode <span style="color:#8ba4a4;font-weight:400;">&mdash; a weekly check-in in your corner</span></td></tr></table></td></tr>
      <tr><td style="padding:14px 4px;border-top:1px solid rgba(226,183,60,0.14);"><table width="100%" role="presentation"><tr><td width="30" valign="top" style="color:#e2b73c;font-size:16px;">&#10022;</td><td style="color:#eef4f3;font-size:15px;font-weight:600;">Agency &amp; Manager Directory <span style="color:#8ba4a4;font-weight:400;">&mdash; 650+ talent agencies and management companies</span></td></tr></table></td></tr>
      <tr><td style="padding:14px 4px;border-top:1px solid rgba(226,183,60,0.14);border-bottom:1px solid rgba(226,183,60,0.14);"><table width="100%" role="presentation"><tr><td width="30" valign="top" style="color:#e2b73c;font-size:16px;">&#10022;</td><td style="color:#eef4f3;font-size:15px;font-weight:600;">Actor Card + QR <span style="color:#8ba4a4;font-weight:400;">&mdash; your whole profile in one scan</span></td></tr></table></td></tr>
    </table>
    <div style="text-align:center;margin-top:30px;">
      <a href="${upgrade}" style="display:inline-block;background:linear-gradient(90deg,#f4d987,#d9a92e);color:#241a05;text-decoration:none;padding:16px 48px;border-radius:40px;font-weight:800;font-size:15.5px;letter-spacing:0.3px;box-shadow:0 0 26px rgba(226,183,60,0.45),0 8px 20px rgba(0,0,0,0.4);">Unlock Premium &rarr;</a>
      <p style="margin:16px 0 0;font-size:12px;letter-spacing:1px;color:#7c8f8f;">PLANS FROM $8.25 / MONTH &middot; CANCEL ANYTIME</p>
    </div>
  </td>
</tr>

<!-- FOOTER -->
<tr>
  <td class="foot-pad" style="background:#ffffff;padding:24px 32px 28px;text-align:center;">
    <p style="margin:0 0 10px;font-size:12px;color:#94a3b8;line-height:1.8;">You're receiving this because you signed up for CastSlate casting recommendations.</p>
    <p style="margin:0 0 14px;font-size:12px;line-height:1.6;">
      <a href="${browse}" style="color:#4338ca;text-decoration:none;font-weight:600;">Browse castings</a>
      <span style="color:#e2e8f0;margin:0 8px;">&bull;</span>
      <a href="${unsub}" style="color:#4338ca;text-decoration:none;font-weight:600;">Unsubscribe</a>
      <span style="color:#e2e8f0;margin:0 8px;">&bull;</span>
      <a href="mailto:${CONTACT_EMAIL}" style="color:#4338ca;text-decoration:none;font-weight:600;">${CONTACT_EMAIL}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;"><a href="${home}" style="color:#94a3b8;text-decoration:none;font-weight:700;">CastSlate</a> &mdash; The casting platform built for working actors.</p>
  </td>
</tr>

</table>
</td></tr></table>
</body></html>`;
}

function subjectFor(slot: string, count: number, hero: Hero | null = null): string {
  if (hero) return `${hero.subject_hook} — ${count} ${count===1?"role":"roles"} open today`;
  // Append the NY date so every send has a unique subject — this stops Gmail's
  // conversation view from collapsing separate daily emails into one thread.
  const day = new Date().toLocaleDateString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric"});
  if (slot === "evening") {
    return count ? `Still open tonight: ${count} casting${count!==1?"s":""} for you — ${day}` : `Tonight's open castings on CastSlate — ${day}`;
  }
  return count ? `${count} new casting${count!==1?"s":""} for you — ${day}` : `New castings are waiting — ${day}`;
}

serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});

  // Dedicated unsubscribe for THIS campaign only (keeps their digest intact).
  // Handles BOTH ways a person unsubscribes, so neither can silently fail:
  //   • GET  — the visible "Unsubscribe" link in the email body (a browser click).
  //   • POST — the native one-click button Gmail/Apple Mail render from the
  //            List-Unsubscribe header (RFC 8058; body is "List-Unsubscribe=One-Click",
  //            NOT JSON). Both carry ?action=unsubscribe&uid=... in the URL, so we
  //            match on that and MUST handle it before any req.json() parse below.
  {
    const url=new URL(req.url);
    if((req.method==="GET"||req.method==="POST")&&url.searchParams.get("action")==="unsubscribe"&&url.searchParams.get("uid")){
      const uid=url.searchParams.get("uid")!;
      const slot=(url.searchParams.get("slot")==="evening")?"evening":"noon";
      const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);
      // Only log the opt-out event once (skip if they were already opted out) so
      // the per-slot "Unsubscribed" stat counts people, not repeat link clicks.
      const{data:existing}=await sb.from("email_preferences").select("premium_upsell_optout").eq("user_id",uid).maybeSingle();
      await sb.from("email_preferences").upsert(
        {user_id:uid,premium_upsell_optout:true,updated_at:new Date().toISOString()},
        {onConflict:"user_id"}
      );
      if(!existing || existing.premium_upsell_optout!==true){
        try{ await sb.from("premium_upsell_logs").insert({user_id:uid,slot,status:"skipped",reason:"unsubscribe_click"}); }catch(_){ /* non-fatal */ }
      }
      // Visible link (GET) → friendly confirmation page. One-click (POST) → 200 OK.
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
    const slot=(body.slot==="evening")?"evening":"noon";

    // Auth: service-role/admin secret OR an admin user JWT.
    let authorized = !!secret && (secret===SUPABASE_SERVICE_KEY || (ADMIN_SECRET && secret===ADMIN_SECRET));
    if(!authorized){
      const authz=req.headers.get("Authorization")||"";
      if(authz.startsWith("Bearer ")){
        try{
          const{data:{user}}=await sb.auth.getUser(authz.slice(7));
          if(user){ const{data:prof}=await sb.from("profiles").select("user_type").eq("id",user.id).maybeSingle(); if(prof&&["admin","super_admin"].includes(prof.user_type)) authorized=true; }
        }catch(_){ /* fall through */ }
      }
    }
    if(!authorized) return res({error:"Unauthorized"},401);

    if(!emailConfigured()) return res({error:"Email provider not configured"},500);

    // ── TEST: preview send to one address (does not touch logs/recipients). ──
    if(action==="test"){
      if(!to_email) return res({error:"to_email required"},400);
      const today=new Date().toISOString().slice(0,10);
      let thero: Hero | null = null;
      try{
        const{data:hs}=await sb.from("site_settings").select("hero_rotation_enabled").eq("id",1).maybeSingle();
        if(hs?.hero_rotation_enabled || body.force_hero){
          const{data:h}=await sb.rpc("get_next_email_hero");
          if(h) thero = (Array.isArray(h) ? h[0] : h) as Hero;
        }
      }catch(e){ console.error("[upsell] hero unavailable:", (e as Error).message); }
      const nowTest=new Date().toISOString();
      const{data:cs}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).or(`expires_at.is.null,expires_at.gte.${today}`).or(`go_live_at.is.null,go_live_at.lte.${nowTest}`).order("created_at",{ascending:false}).limit(3);
      // Pull the real roles too — a test send with empty role rows does not show
      // what recipients actually get, which is the whole point of a test.
      const trb:Record<string,any[]>={};
      if(cs?.length){
        const{data:troles}=await sb.from("roles").select("id,casting_id,name,age_range,gender,pay").in("casting_id",cs.map((c:any)=>c.id));
        (troles||[]).forEach((r:any)=>{(trb[r.casting_id]??=[]).push(r);});
      }
      const preview=(cs||[]).map((c:any)=>({...c,posted_at:c.created_at,roles:trb[c.id]||[]}));
      if(!preview.length) preview.push({id:"preview",title:'Indie Feature — "The Long Winter"',type:"Film",location:"New York, NY",union_status:"SAG-AFTRA",pay:"$2,500/week",synopsis:"A character-driven drama about a Brooklyn ceramicist navigating her first gallery show.",slug:"sample",posted_at:new Date().toISOString(),roles:[{name:"NADIA",age_range:"28–38",gender:"Female",pay:"$2,500/week"}]});
      const html=buildEmail("there",preview,"test",slot,thero);
      const r=await sendEmail({from:FROM_EMAIL,to:[to_email],replyTo:CONTACT_EMAIL,subject:subjectFor(slot,preview.length,thero),html});
      if(!r.ok) return res({error:r.err},500);
      return res({ok:true,test:true,slot,to:to_email,provider_id:r.id});
    }

    if(action!=="run") return res({error:"Unknown action"},400);

    // ── RUN: the twice-daily campaign. ──
    const{data:cfg}=await sb.from("site_settings").select("premium_upsell_enabled,premium_upsell_paused").eq("id",1).maybeSingle();
    if(cfg && cfg.premium_upsell_enabled===false) return res({ok:false,message:"Disabled",slot,sent:0,skipped:0});
    if(cfg && cfg.premium_upsell_paused===true)   return res({ok:false,message:"Paused",slot,sent:0,skipped:0});

    // ── Non-premium talent profiles (paginated). membership_status != 'active'
    //    (null counts as free). Anyone who upgraded is excluded here + guarded below.
    const profiles:any[]=[];
    {
      const PAGE=1000; let from=0;
      while(true){
        const{data,error}=await sb.from("profiles")
          .select("id,display_name,notification_email,membership_status,age")
          .in("user_type",["talent","actor"])
          .eq("account_status","active")
          .eq("visible",true)
          .or("membership_status.is.null,membership_status.neq.active")
          .order("created_at",{ascending:true})
          .range(from,from+PAGE-1);
        if(error){ console.error("[premium-upsell] profiles page error",error); break; }
        if(!data?.length) break;
        profiles.push(...data);
        if(data.length<PAGE) break;
        from+=PAGE;
      }
    }
    if(!profiles.length) return res({ok:true,message:"No eligible users",slot,sent:0,skipped:0});

    const uids=profiles.map((p:any)=>p.id);

    // ── Per-user email preferences (for the dedicated opt-out + notif flag). ──
    const pm:Record<string,any>={};
    {
      const CH=300;
      for(let i=0;i<uids.length;i+=CH){
        const{data:prefs}=await sb.from("email_preferences").select("*").in("user_id",uids.slice(i,i+CH));
        (prefs||[]).forEach((p:any)=>{pm[p.user_id]=p;});
      }
    }

    // ── Recipient emails direct from auth.users (authoritative, covers new accounts). ──
    const emailMap:Record<string,string>={};
    {
      const CH=1000;
      for(let i=0;i<uids.length;i+=CH){
        const{data,error}=await sb.rpc("get_digest_emails",{uids:uids.slice(i,i+CH)});
        if(error){ console.error("[premium-upsell] get_digest_emails error",error); continue; }
        (data||[]).forEach((r:any)=>{ if(r?.id&&r?.email) emailMap[r.id]=r.email; });
      }
    }

    // ── Suppression list (hard bounces + complaints + manual unsubs). ──
    const suppressed=new Set<string>();
    {
      const PAGE=1000; let from=0;
      while(true){
        const{data,error}=await sb.from("email_unsubscribes").select("email").range(from,from+PAGE-1);
        if(error){ console.error("[premium-upsell] suppression load error",error); break; }
        if(!data?.length) break;
        data.forEach((r:any)=>{ if(r.email) suppressed.add(String(r.email).trim().toLowerCase()); });
        if(data.length<PAGE) break; from+=PAGE;
      }
    }

    // ── Active castings + roles (for the personalized job cards). ──
    const today=new Date().toISOString().slice(0,10);
    // One still per run — every recipient in this slot gets the same frame.
    let runHero: Hero | null = null;
    try{
      const{data:hs}=await sb.from("site_settings").select("hero_rotation_enabled").eq("id",1).maybeSingle();
      if(hs?.hero_rotation_enabled){
        const{data:h}=await sb.rpc("get_next_email_hero");
        if(h) runHero = (Array.isArray(h) ? h[0] : h) as Hero;
      }
    }catch(e){ console.error("[upsell] hero unavailable:", (e as Error).message); }
    // RECENCY WINDOW — same rule as the daily digest. Draw only from the N most
    // recently POSTED active castings, so this campaign can never resurface a
    // months-old listing just because it is still technically open.
    const RECENT_POOL=20;
    // Same go-live guard as the digest: a casting scheduled for a future date is
    // already published=true and merely hidden by the site, so without this it
    // would be emailed before anyone could open it.
    const goLiveGate=new Date().toISOString();
    const{data:castings}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).or(`expires_at.is.null,expires_at.gte.${today}`).or(`go_live_at.is.null,go_live_at.lte.${goLiveGate}`).order("created_at",{ascending:false}).limit(RECENT_POOL);
    const cwr:any[]=[];
    if(castings?.length){
      const cids=castings.map((c:any)=>c.id);
      const rb:Record<string,any[]>={};
      for(let i=0;i<cids.length;i+=200){
        const{data:roles}=await sb.from("roles").select("id,casting_id,name,age_range,gender,pay").in("casting_id",cids.slice(i,i+200));
        (roles||[]).forEach((r:any)=>{(rb[r.casting_id]??=[]).push(r);});
      }
      castings.forEach((c:any)=>cwr.push({...c,posted_at:c.created_at,roles:rb[c.id]||[]}));
    }
    const shuffle=(arr:any[])=>{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; };
    const JOB_CAP=3;

    // ── Phase 1: decide each user's email (in-memory). ──
    interface Out{ userId:string; email:string; subject:string; html:string; }
    const outbox:Out[]=[];
    const logs:Record<string,unknown>[]=[];
    let sent=0, skipped=0, failed=0;
    const skipReasons:Record<string,number>={};
    const bump=(r:string)=>{ skipReasons[r]=(skipReasons[r]||0)+1; };

    for(const p of profiles){
      const email=emailMap[p.id]||null;
      const pf=pm[p.id]??{};
      // Backstop: never email a premium member even if the query ever returns one.
      if(p.membership_status==="active"){ skipped++; bump("premium"); continue; }
      let skipReason:string|null=null;
      if(pf.premium_upsell_optout===true)     skipReason="campaign_optout";
      else if(p.notification_email===false)   skipReason="email_notifications_off";
      else if(!email)                         skipReason="no_email";
      else if(suppressed.has(String(email).trim().toLowerCase())) skipReason="suppressed";
      if(skipReason){ skipped++; bump(skipReason); logs.push({user_id:p.id,email,slot,status:"skipped",reason:skipReason}); continue; }

      // Personalized job cards (best-effort; email still sends with 0 matches).
      const pool=cwr.filter((c:any)=>matches(pf,c) && castingAgeOk(c,p.age));
      // NEWEST-FIRST GUARANTEE. A pure shuffle means a casting posted an hour ago
      // can lose the coin toss and never appear. Hoist the newest matching casting
      // to the front so anything just posted is ALWAYS included; the remaining
      // slots stay shuffled so the rest of the mix still varies between sends.
      const newest=pool.reduce((best:any,c:any)=>
        (!best||String(c.created_at||c.posted_at||"")>String(best.created_at||best.posted_at||"")) ? c : best, null);
      const rest=shuffle(pool.filter((c:any)=>!newest||c.id!==newest.id));
      const batch=(newest?[newest,...rest]:rest).slice(0,JOB_CAP)
        .sort((a:any,b:any)=>String(b.created_at||b.posted_at||"").localeCompare(String(a.created_at||a.posted_at||"")));
      const first=(p.display_name??"").split(" ")[0].trim()||"there";
      outbox.push({ userId:p.id, email, subject:subjectFor(slot,batch.length,runHero), html:buildEmail(first,batch,p.id,slot,runHero) });
    }

    // ── Phase 2: send in batches of 100 via Resend, log each result. ──
    const BATCH=100;
    for(let i=0;i<outbox.length;i+=BATCH){
      const group=outbox.slice(i,i+BATCH);
      const results=await sendBatch(group.map((o)=>({from:FROM_EMAIL,to:[o.email],replyTo:CONTACT_EMAIL,subject:o.subject,html:o.html,headers:{"List-Unsubscribe":`<${UNSUB_BASE}?action=unsubscribe&uid=${o.userId}&slot=${slot}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}})));
      group.forEach((o,idx)=>{
        const r=results[idx];
        if(r?.ok){ sent++; logs.push({user_id:o.userId,email:o.email,slot,status:"sent",provider_message_id:r.id}); }
        else{ failed++; logs.push({user_id:o.userId,email:o.email,slot,status:"failed",error_message:r?.err}); }
      });
      if(i+BATCH<outbox.length) await new Promise((r)=>setTimeout(r,600));
    }

    // ── Bulk-write logs. ──
    for(let i=0;i<logs.length;i+=500){
      try{ await sb.from("premium_upsell_logs").insert(logs.slice(i,i+500)); }catch(e){ console.error("[premium-upsell] log insert failed",e); }
    }

    const summary={ok:true,slot,sent,skipped,failed,total_users:profiles.length,skip_reasons:skipReasons};
    console.log("[premium-upsell] run complete",JSON.stringify(summary));
    return res(summary);
  }catch(e){
    console.error("[premium-upsell]",e);
    return res({error:String(e)},500);
  }
});

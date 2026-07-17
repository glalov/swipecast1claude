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
// Personalization (the point of this campaign):
//   • The "✓ You applied" card shows the user's MOST RECENT real application (any
//     casting, even if now closed). If the user has never applied, that card is
//     omitted and we show three LOCKED castings instead.
//   • LOCKED cards = recent castings (posted this week, preference- & age-matched)
//     the user has NOT applied to — the roles their weekly submission cap kept them
//     from. We never show a locked card for a casting they already applied to.
//   • If a user has nothing to show (no application AND no unseen castings), they are
//     skipped rather than sent an empty email.

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
const LOGO_URL             = `${APP_URL}/email/castslate-logo.png`;
const QR_URL               = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&qzone=1&color=1a1b2e&bgcolor=ffffff&data=" + encodeURIComponent(`${APP_URL}/membership`);

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

function esc(s: any): string { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

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

// ── Cards ──
function appliedCard(c: any): string {
  const meta=[c.location||"Location TBD", c.union_status, c.pay].filter(Boolean).map(esc).join(" &nbsp;&middot;&nbsp; ");
  return `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:12px;border-radius:12px;overflow:hidden;border:1px solid #e4ddcf;background:#ffffff;">
    <tr>
      <td style="width:4px;background:#37696A;" width="4"></td>
      <td style="padding:16px 18px;">
        <div style="font-size:16px;font-weight:800;color:#1a1b2e;">${esc(c.title)}</div>
        <div style="font-size:12px;color:#9a9384;margin-top:3px;">&#128205; ${meta}</div>
        <div style="margin-top:10px;"><span style="display:inline-block;background:#eaf1f0;color:#37696A;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700;">&#10003; You applied</span></div>
      </td>
    </tr>
    </table>`;
}
function lockedCard(c: any): string {
  const bits=[c.location||"Location", c.pay?"Paid":null, closesLabel(c.deadline||null)].filter(Boolean).map(esc).join(" &nbsp;&middot;&nbsp; ");
  return `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:10px;border-radius:12px;overflow:hidden;border:1px solid #e4ddcf;background:#fbfaf6;">
    <tr>
      <td style="width:4px;background:#c9c0ad;" width="4"></td>
      <td style="padding:15px 18px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td style="vertical-align:middle;">
            <div style="font-size:15px;font-weight:800;color:#b8b09d;letter-spacing:0.4px;">${esc(c.title)} &nbsp;&bull;&bull;&bull;&bull;</div>
            <div style="font-size:12px;color:#c4bca9;margin-top:3px;">&#128274; ${bits}</div>
          </td>
          <td style="text-align:right;vertical-align:middle;white-space:nowrap;"><span style="font-size:20px;">&#128274;</span></td>
        </tr></table>
      </td>
    </tr>
    </table>`;
}

interface BuildInput { firstName:string; userId:string; freshCount:number; appliedThisWeek:number; applied:any|null; locked:any[]; moreCount:number; }
function buildEmail(b: BuildInput): string {
  const unsub  = `${UNSUB_BASE}?action=unsubscribe&uid=${b.userId}`;
  const cardsHtml = (b.applied ? appliedCard(b.applied) : "") + b.locked.map(lockedCard).join("");
  const N = b.freshCount;
  const headTop = N>0 ? `${N} casting${N!==1?"s":""} dropped this week.` : `New castings dropped this week.`;
  const headBot = N>0 ? (b.appliedThisWeek>0 ? `You applied to ${b.appliedThisWeek}.` : `You applied to none.`) : ``;
  const moreLine = b.moreCount>0
    ? `<div style="text-align:center;padding:6px 0 4px;"><span style="font-size:13px;color:#9a9384;font-weight:600;">+ ${b.moreCount} more role${b.moreCount!==1?"s":""} you couldn't submit to this week</span></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>${esc(headTop)} &mdash; CastSlate</title>
<style>
@media only screen and (max-width:620px){
  .wrap{padding:20px 10px !important;}
  .shell{border-radius:0 !important;}
  .pad{padding:22px 20px !important;}
  .hl{font-size:26px !important;}
  .sub{font-size:15px !important;}
  .qr-stack{display:block !important;width:100% !important;}
  .qr-stack td{display:block !important;width:100% !important;box-sizing:border-box !important;}
  .qrc-qr{text-align:center !important;padding:22px 0 14px !important;}
  .qrc-list{text-align:left !important;padding:2px 24px 20px !important;}
  .two-col{display:block !important;width:100% !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#e9efee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">The castings you missed this week — Premium members already applied. Paper headshots are over. This is the digital slate.</div>

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="wrap" style="background:#e9efee;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" class="shell" style="background:#f7f5f0;max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 4px 34px rgba(26,27,46,0.14);">

<tr>
  <td style="background:#1a1b2e;padding:16px 26px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td style="vertical-align:middle;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td style="vertical-align:middle;padding-right:11px;">
            <img src="${LOGO_URL}" width="30" height="30" alt="CastSlate" style="display:block;border-radius:7px;border:none;outline:none;text-decoration:none;" />
          </td>
          <td style="vertical-align:middle;"><span style="font-size:19px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;">CastSlate</span></td>
        </tr></table>
      </td>
      <td style="text-align:right;vertical-align:middle;"><span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.42);letter-spacing:1.6px;text-transform:uppercase;">Weekly Digest</span></td>
    </tr></table>
  </td>
</tr>

<tr>
  <td class="pad" style="background:#1a1b2e;padding:8px 34px 40px;text-align:center;">
    <div style="display:inline-block;background:rgba(212,163,74,0.16);color:#e0b866;padding:5px 15px;border-radius:30px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:20px;border:1px solid rgba(212,163,74,0.32);">&#9733;&nbsp; Premium members already applied</div>
    <h1 class="hl" style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">${esc(headTop)}${headBot?`<br/>${esc(headBot)}`:""}</h1>
    <p class="sub" style="margin:0 auto;font-size:16px;line-height:1.7;color:rgba(255,255,255,0.72);max-width:430px;">Free members get one submission a week. Premium members applied to every one of these the moment it posted &mdash; first in line.</p>
  </td>
</tr>

<tr>
  <td style="background:#f7f5f0;padding:26px 24px 6px;">
    ${cardsHtml}
    ${moreLine}
  </td>
</tr>

<tr>
  <td style="background:#f7f5f0;padding:18px 24px 30px;text-align:center;">
    <a href="${APP_URL}/membership" style="display:inline-block;background:#37696A;color:#ffffff;text-decoration:none;padding:15px 40px;border-radius:11px;font-size:15px;font-weight:800;letter-spacing:0.2px;box-shadow:0 6px 18px rgba(55,105,106,0.32);">Unlock every casting &rarr;</a>
    <div style="margin-top:12px;font-size:12px;color:#a49c8a;">Submit as often as you want &middot; See roles first &middot; Cancel anytime</div>
  </td>
</tr>

<tr><td style="background:#f7f5f0;padding:0 34px;"><div style="height:1px;background:#e4ddcf;"></div></td></tr>

<tr>
  <td class="pad" style="background:#f7f5f0;padding:34px 34px 28px;">
    <div style="display:inline-block;background:#eaf1f0;color:#37696A;padding:4px 13px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;margin-bottom:16px;">The industry went digital</div>
    <h2 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#1a1b2e;line-height:1.25;letter-spacing:-0.3px;">Your whole career on one QR code.</h2>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.72;color:#5f5a4e;">Nobody hands out paper headshots anymore. A photo stapled to a resume can't show your reel, your range, or your latest look. Your CastSlate business card can &mdash; one scan and an agent or casting director sees <strong style="color:#1a1b2e;">everything.</strong></p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="qr-stack" style="background:#1a1b2e;border-radius:16px;overflow:hidden;">
    <tr>
      <td class="qrc-qr" style="padding:24px;vertical-align:middle;width:150px;" width="150" align="center">
        <div style="background:#ffffff;border-radius:12px;padding:12px;display:inline-block;line-height:0;">
          <img src="${QR_URL}" width="108" height="108" alt="Scan to view a CastSlate profile" style="display:block;border:none;outline:none;text-decoration:none;" />
        </div>
      </td>
      <td class="qrc-list" style="padding:24px 26px 24px 6px;vertical-align:middle;">
        <div style="font-size:11px;font-weight:800;color:#e0b866;letter-spacing:1.4px;text-transform:uppercase;margin-bottom:8px;">One scan reveals</div>
        <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
          <tr><td style="padding:4px 0;font-size:14px;color:#ffffff;">&#127909;&nbsp; Multiple showreels &amp; self-tapes</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#ffffff;">&#128247;&nbsp; A full gallery of looks &mdash; not one still</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#ffffff;">&#128220;&nbsp; Live resume, credits &amp; stats</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#ffffff;">&#128241;&nbsp; Always current &mdash; update once, it's live</td></tr>
        </table>
      </td>
    </tr>
    </table>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.65;color:#8a8474;text-align:center;font-style:italic;">Hand someone a headshot and it's outdated by your next haircut. Hand them your card and they see the real, current you &mdash; in motion.</p>
  </td>
</tr>

<tr><td style="background:#f7f5f0;padding:0 34px;"><div style="height:1px;background:#e4ddcf;"></div></td></tr>

<tr>
  <td class="pad" style="background:#f7f5f0;padding:32px 34px 30px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="two-col"><tr>
      <td style="vertical-align:top;padding-right:16px;width:56px;" width="56">
        <div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#37696A,#2b5152);text-align:center;line-height:52px;font-size:26px;">&#127891;</div>
      </td>
      <td style="vertical-align:top;">
        <div style="display:inline-block;background:#f3ecdd;color:#a67c1e;padding:3px 11px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:9px;">Premium &middot; Manager Mode</div>
        <h2 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;color:#1a1b2e;line-height:1.28;letter-spacing:-0.3px;">A teacher in your pocket.</h2>
        <p style="margin:0;font-size:15px;line-height:1.7;color:#5f5a4e;">Every week, Manager Mode checks in on where you stand &mdash; which roles to chase, what to sharpen on your profile, and your next move to book more work. It's the kind of guidance actors usually pay a manager for &mdash; right in your corner, every single week.</p>
      </td>
    </tr></table>
  </td>
</tr>

<tr>
  <td style="background:#1a1b2e;padding:34px 34px 36px;text-align:center;">
    <h2 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">The old world used paper. You're in the new one.</h2>
    <p style="margin:0 auto 22px;font-size:14px;line-height:1.65;color:rgba(255,255,255,0.68);max-width:400px;">Unlimited submissions, every casting the moment it drops, your digital card, and a manager in your corner.</p>
    <a href="${APP_URL}/membership" style="display:inline-block;background:#e0b866;color:#1a1b2e;text-decoration:none;padding:15px 42px;border-radius:11px;font-size:15px;font-weight:800;letter-spacing:0.2px;">Go Premium</a>
    <div style="margin-top:14px;font-size:12px;color:rgba(255,255,255,0.4);">Cancel anytime &middot; Keep your digital card forever</div>
  </td>
</tr>

<tr>
  <td style="background:#f7f5f0;padding:22px 30px 26px;">
    <p style="margin:0 0 10px;font-size:12px;color:#a49c8a;line-height:1.8;">You're receiving this weekly digest because you signed up for CastSlate casting recommendations.</p>
    <p style="margin:0 0 14px;font-size:12px;line-height:1.6;">
      <a href="${APP_URL}/account-settings" style="color:#37696A;text-decoration:none;font-weight:600;">Manage preferences</a>
      <span style="color:#d8d0bf;margin:0 8px;">&bull;</span>
      <a href="${unsub}" style="color:#37696A;text-decoration:none;font-weight:600;">Unsubscribe</a>
      <span style="color:#d8d0bf;margin:0 8px;">&bull;</span>
      <a href="mailto:${CONTACT_EMAIL}" style="color:#37696A;text-decoration:none;font-weight:600;">${CONTACT_EMAIL}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#c4bca9;"><span style="color:#8a8474;font-weight:700;">CastSlate</span> &mdash; The casting platform built for working actors.</p>
  </td>
</tr>

</table>
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

    // Build one user's personalized email inputs. Returns null when there's nothing to show.
    function decide(p:any, pf:any, appliedCasting:any|null, appliedThisWeek:number, appliedIds:Set<string>, cwr:any[]): BuildInput|null {
      const pool=cwr.filter((c:any)=>matches(pf,c) && castingAgeOk(c,p.age) && !appliedIds.has(c.id));
      const fresh=pool.filter((c:any)=>(c.created_at||c.posted_at)>=weekAgoIso);
      const lockedPoolFull = fresh.length ? fresh : pool;   // prefer this week; fall back to any active unseen
      const lockedPool = shuffle(lockedPoolFull.slice());
      const lockCap = appliedCasting ? 2 : 3;
      const locked = lockedPool.slice(0,lockCap);
      if(!appliedCasting && locked.length===0) return null;  // nothing to show → skip
      const freshCount = fresh.length || pool.length;
      const moreCount = Math.max(0, lockedPool.length - locked.length);
      const first=(p.display_name??"").split(" ")[0].trim()||"there";
      return { firstName:first, userId:p.id, freshCount, appliedThisWeek, applied:appliedCasting, locked, moreCount };
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
        const appliedThisWeek=(apps||[]).filter((a:any)=>a.created_at>=weekAgoIso).length;
        const appliedIds=new Set<string>((apps||[]).map((a:any)=>a.casting_id));
        let appliedCasting:any=null;
        if(apps&&apps.length){ const{data:cc}=await sb.from("castings").select("id,title,location,union_status,pay").eq("id",apps[0].casting_id).maybeSingle(); appliedCasting=cc||null; }
        const inp=decide(p||{id:asId,display_name:"there"}, pf||{}, appliedCasting, appliedThisWeek, appliedIds, cwr);
        if(!inp) return res({ok:false,message:"That user has nothing to show (no application + no unseen castings)."});
        const r=await sendEmail({from:FROM_EMAIL,to:[to_email],replyTo:CONTACT_EMAIL,subject:subjectFor(),html:buildEmail(inp)});
        return r.ok ? res({ok:true,test:true,rendered_for:asId,to:to_email,provider_id:r.id}) : res({error:r.err},500);
      }
      // Generic sample (no specific user): 1 applied + 2 locked from recent castings.
      const sample=cwr.slice(0,3);
      const applied=sample[0] ? {id:sample[0].id,title:sample[0].title,location:sample[0].location,union_status:sample[0].union_status,pay:sample[0].pay} : {id:"s",title:'Indie Feature — Brooklyn',location:"New York, NY",union_status:"SAG-AFTRA",pay:"$2,500/wk"};
      const locked=sample.slice(1,3).length?sample.slice(1,3):[{id:"l1",title:"National Commercial — Lead",location:"Los Angeles",pay:"Paid",deadline:null},{id:"l2",title:"Netflix Series — Recurring",location:"Atlanta, GA",pay:null,deadline:null}];
      const inp:BuildInput={firstName:"there",userId:"test",freshCount:6,appliedThisWeek:1,applied,locked,moreCount:3};
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

    // Per-user application aggregates: latest casting + 7-day count.
    const latestCastingId:Record<string,string>={};
    const appliedThisWeek:Record<string,number>={};
    { const CH=300; for(let i=0;i<uids.length;i+=CH){ const{data,error}=await sb.rpc("weekly_upsell_user_apps",{uids:uids.slice(i,i+CH)}); if(error){ console.error("[weekly-upsell] user_apps rpc error",error); continue; } (data||[]).forEach((r:any)=>{ if(r?.talent_id){ if(r.latest_casting_id) latestCastingId[r.talent_id]=r.latest_casting_id; appliedThisWeek[r.talent_id]=Number(r.apps_7d)||0; } }); } }

    // Applied casting details (may be closed / not in the active pool).
    const appliedCastingMap:Record<string,any>={};
    { const ids=[...new Set(Object.values(latestCastingId))]; for(let i=0;i<ids.length;i+=200){ const{data}=await sb.from("castings").select("id,title,location,union_status,pay").in("id",ids.slice(i,i+200)); (data||[]).forEach((c:any)=>{appliedCastingMap[c.id]=c;}); } }

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

      const lcid=latestCastingId[p.id];
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

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
function ago(iso: string): string {
  const h = Math.floor((Date.now()-new Date(iso).getTime())/3600000);
  const d = Math.floor(h/24);
  if(h<1) return "Just posted";
  if(h<24) return `${h}h ago`;
  if(d<7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric"});
}

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

// Green-tile casting card — matches the approved preview design.
function card(c: any): string {
  const roles = (c.roles||[]).slice(0,2);
  const more  = Math.max(0,(c.roles||[]).length-2);
  const link  = `${APP_URL}/casting/${c.slug}`;
  const typePill  = c.type        ? `<span style="display:inline-block;background:#e3efef;color:#37696A;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin:0 4px 4px 0;">${String(c.type).toUpperCase()}</span>` : "";
  const unionPill = c.union_status ? `<span style="display:inline-block;background:#eef4f4;color:#5a7373;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin:0 4px 4px 0;">${c.union_status}</span>` : "";
  const paidPill  = c.pay         ? `<span style="display:inline-block;background:#e7f6ec;color:#15803d;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin:0 4px 4px 0;">$ PAID</span>` : "";
  const rolesBlock = roles.length ? `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin:10px 0 14px;border-top:1px solid #dcebeb;">
      ${roles.map((r:any)=>{
        const p=[`<strong style="color:#1A1A2E;font-size:12px">${r.name||"Role"}</strong>`];
        if(r.age_range) p.push(`<span style="color:#5f7373;font-size:12px">${r.age_range}</span>`);
        if(r.gender&&String(r.gender).toLowerCase()!=="any") p.push(`<span style="color:#5f7373;font-size:12px">${r.gender}</span>`);
        if(r.pay) p.push(`<span style="color:#16a34a;font-size:12px;font-weight:600">${r.pay}</span>`);
        return `<tr><td style="padding:7px 0 3px;">${p.join(" <span style='color:#aecccc'>&middot;</span> ")}</td></tr>`;
      }).join("")}
      ${more>0?`<tr><td style="padding:4px 0;font-size:11px;color:#8aa;">+${more} more role${more>1?"s":""}</td></tr>`:""}
    </table>` : "";
  const synopsis = c.synopsis
    ? `<p style="margin:0 0 12px;font-size:13px;color:#5f7373;line-height:1.65;">${String(c.synopsis).slice(0,180)}${String(c.synopsis).length>180?"&hellip;":""}</p>`
    : "";
  return `
<table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:12px;border-radius:12px;overflow:hidden;border:1px solid #d9e9e9;background:#f1f7f7;">
<tr>
  <td style="width:4px;background:#4F8A8B;" width="4"></td>
  <td style="padding:16px 18px 16px 16px;">
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:8px;"><tr>
      <td style="vertical-align:top;">
        <div style="font-size:16px;font-weight:800;color:#1A1A2E;line-height:1.3;margin-bottom:4px;">${c.title}</div>
        <div style="font-size:12px;color:#6b8a8a;">&#128205;&nbsp;${c.location||"Location TBD"}</div>
      </td>
      <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
        <span style="font-size:11px;color:#6b8a8a;">${ago(c.posted_at)}</span>
      </td>
    </tr></table>
    <div style="margin:6px 0 10px;">${typePill}${unionPill}${paidPill}</div>
    ${synopsis}
    ${rolesBlock}
    <a href="${link}" style="display:inline-block;background:linear-gradient(90deg,#4F8A8B,#37696A);color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:700;">View Casting &rarr;</a>
  </td>
</tr>
</table>`;
}

// ── The email — teal header + logo, job cards, dark Premium spotlight (Version D). ──
function buildEmail(firstName: string, castings: any[], userId: string, slot: string): string {
  const count      = castings.length;
  const cards      = castings.map(card).join("");
  const unsub      = `${UNSUB_BASE}?action=unsubscribe&uid=${userId}&slot=${slot}`;
  const browse     = `${APP_URL}/browse-castings`;
  const upgrade    = `${APP_URL}/membership`;
  const home       = APP_URL;
  const logoImgUrl = `${APP_URL}/logo-email.png`;
  const greetLead  = slot === "evening" ? "Before the day's out" : "Fresh for you today";

  const cmp = (free: string, prem: string, freeStrong = false) => `
      <tr>
        <td style="padding:13px 16px;border-bottom:1px solid rgba(255,255,255,0.07);border-right:1px solid rgba(255,255,255,0.08);font-size:13.5px;color:#93a6b0;">${freeStrong?`<strong style="color:#c9b990;">${free}</strong>`:free}</td>
        <td style="padding:13px 16px;border-bottom:1px solid rgba(255,255,255,0.07);font-size:13.5px;color:#ffffff;font-weight:700;">${prem}</td>
      </tr>`;

  const jobsSection = count ? `
<tr>
  <td style="background:#ffffff;padding:22px 22px 4px;">${cards}</td>
</tr>
<tr>
  <td style="background:#ffffff;padding:14px 28px 28px;text-align:center;">
    <a href="${browse}" style="display:inline-block;background:#ffffff;color:#37696A;text-decoration:none;padding:11px 30px;border-radius:9px;font-size:14px;font-weight:700;border:2px solid #4F8A8B;">Browse All Castings</a>
  </td>
</tr>` : `
<tr>
  <td style="background:#ffffff;padding:8px 28px 26px;text-align:center;">
    <a href="${browse}" style="display:inline-block;background:#ffffff;color:#37696A;text-decoration:none;padding:11px 30px;border-radius:9px;font-size:14px;font-weight:700;border:2px solid #4F8A8B;">Browse Open Castings</a>
  </td>
</tr>`;

  const headline = count
    ? (count===1 ? "A fresh role matched to you" : `${count} fresh roles matched to you`)
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
  .wrap{padding:20px 0 !important;}
  .shell{border-radius:0 !important;}
  .head-pad{padding:26px 20px 24px !important;}
  .body-pad{padding:28px 20px 8px !important;}
  .prem-pad{padding:28px 20px !important;}
  .hl{font-size:23px !important;}
  .foot-pad{padding:22px 20px 26px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="wrap" style="background:#f0f4f4;padding:28px 16px;">
<tr><td align="center">

<table width="600" cellpadding="0" cellspacing="0" role="presentation" class="shell" style="background:#ffffff;max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 4px 30px rgba(47,95,96,0.15);">

<!-- HEADER — teal gradient + logo -->
<tr>
  <td class="head-pad" style="background:#4F8A8B;background:linear-gradient(135deg,#2f5f60 0%,#4F8A8B 55%,#5fa0a1 100%);border-top:3px solid #6fb0b1;padding:34px 36px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td valign="middle" style="width:52px;">
        <a href="${home}" style="text-decoration:none;"><span style="display:inline-block;background:#ffffff;border-radius:12px;padding:9px;line-height:0;box-shadow:0 4px 14px rgba(0,0,0,0.20);">
          <img src="${logoImgUrl}" alt="CastSlate" width="30" height="30" style="display:block;border:none;outline:none;"/>
        </span></a>
      </td>
      <td valign="middle" style="padding-left:14px;">
        <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1;">CastSlate</div>
        <div style="margin-top:4px;font-size:11px;font-weight:600;color:#dff1f1;letter-spacing:2px;text-transform:uppercase;">Get seen. Get cast.</div>
      </td>
      <td valign="middle" align="right">
        <span style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.28);color:#f2fbfb;font-size:11px;font-weight:700;letter-spacing:0.5px;padding:5px 13px;border-radius:20px;text-transform:uppercase;">Daily Castings</span>
      </td>
    </tr></table>
  </td>
</tr>

<!-- GREETING -->
<tr>
  <td class="body-pad" style="background:#ffffff;padding:32px 36px 10px;text-align:center;">
    ${count?`<div style="display:inline-block;background:#e8f3f3;color:#37696A;padding:5px 15px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">${greetLead}</div>`:""}
    <h1 class="hl" style="margin:0 0 12px;font-size:26px;font-weight:800;color:#1A1A2E;letter-spacing:-0.6px;line-height:1.25;">Hi ${firstName} &mdash; ${headline} &#127916;</h1>
    <p style="margin:0 auto;font-size:15.5px;line-height:1.75;color:#555;max-width:450px;">${sub}</p>
  </td>
</tr>

${jobsSection}

<!-- PREMIUM UPSELL — dark spotlight + Free vs Premium -->
<tr>
  <td class="prem-pad" style="background:linear-gradient(160deg,#16202e 0%,#1e2c3c 60%,#243a44 100%);padding:38px 34px 36px;border-top:3px solid #e2b73c;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:rgba(226,183,60,0.18);border:1px solid rgba(226,183,60,0.4);color:#f0cf7a;font-size:11px;font-weight:800;letter-spacing:1.4px;padding:6px 15px;border-radius:20px;text-transform:uppercase;margin-bottom:14px;">&#9733; See what you're missing</div>
      <h2 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.3;">Do more with CastSlate Premium</h2>
      <p style="margin:0 auto;font-size:14.5px;line-height:1.7;color:#aebfc9;max-width:440px;">You're on the free plan &mdash; here's exactly what it holds back, and what unlocks the moment you upgrade.</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:rgba(255,255,255,0.04);border:1px solid rgba(226,183,60,0.28);border-radius:14px;overflow:hidden;">
      <tr>
        <td style="width:50%;padding:13px 16px;background:rgba(226,183,60,0.10);border-bottom:1px solid rgba(255,255,255,0.10);border-right:1px solid rgba(255,255,255,0.08);"><span style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#e6c98a;">&#128274; Free &mdash; you now</span></td>
        <td style="width:50%;padding:13px 16px;background:rgba(240,207,122,0.18);border-bottom:1px solid rgba(255,255,255,0.10);"><span style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ffe6a8;">&#9733; Premium</span></td>
      </tr>
      ${cmp("1 submission / week","Unlimited submissions",true)}
      ${cmp("No weekly guidance","Manager Mode check-ins")}
      ${cmp("&#128274; Events locked","Monthly NYC networking")}
      ${cmp("Limited storage","Unlimited + message CDs")}
      ${cmp("No business card","Actor Card + QR code")}
    </table>
    <div style="text-align:center;margin-top:26px;">
      <a href="${upgrade}" style="display:inline-block;background:linear-gradient(90deg,#f0cf7a,#d9a92e);color:#231a06;text-decoration:none;padding:15px 44px;border-radius:11px;font-weight:800;font-size:15.5px;letter-spacing:0.1px;box-shadow:0 6px 20px rgba(226,183,60,0.42);">Unlock Premium &rarr;</a>
      <p style="margin:14px 0 0;font-size:12px;color:#8397a2;">$9.99/mo &middot; Cancel anytime &middot; Keep every match you already get</p>
    </div>
  </td>
</tr>

<!-- FOOTER -->
<tr>
  <td class="foot-pad" style="background:#ffffff;padding:24px 32px 28px;text-align:center;">
    <p style="margin:0 0 10px;font-size:12px;color:#94a3b8;line-height:1.8;">You're receiving this because you signed up for CastSlate casting recommendations.</p>
    <p style="margin:0 0 14px;font-size:12px;line-height:1.6;">
      <a href="${browse}" style="color:#4F8A8B;text-decoration:none;font-weight:600;">Browse castings</a>
      <span style="color:#e2e8f0;margin:0 8px;">&bull;</span>
      <a href="${unsub}" style="color:#4F8A8B;text-decoration:none;font-weight:600;">Unsubscribe</a>
      <span style="color:#e2e8f0;margin:0 8px;">&bull;</span>
      <a href="mailto:${CONTACT_EMAIL}" style="color:#4F8A8B;text-decoration:none;font-weight:600;">${CONTACT_EMAIL}</a>
    </p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;"><a href="${home}" style="color:#94a3b8;text-decoration:none;font-weight:700;">CastSlate</a> &mdash; The casting platform built for working actors.</p>
  </td>
</tr>

</table>
</td></tr></table>
</body></html>`;
}

function subjectFor(slot: string, count: number): string {
  if (slot === "evening") {
    return count ? `Still open tonight: ${count} casting${count!==1?"s":""} for you` : "Tonight's open castings on CastSlate";
  }
  return count ? `${count} new casting${count!==1?"s":""} matched to you today` : "New castings are waiting on CastSlate";
}

serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});

  // Dedicated unsubscribe for THIS campaign only (keeps their digest intact).
  if(req.method==="GET"){
    const url=new URL(req.url);
    if(url.searchParams.get("action")==="unsubscribe"&&url.searchParams.get("uid")){
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
      return new Response(null,{ status:302, headers:{"Location":`${APP_URL}/unsubscribed`} });
    }
    return new Response("Not found",{status:404});
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
      const{data:cs}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).order("created_at",{ascending:false}).limit(3);
      const preview=(cs||[]).map((c:any)=>({...c,posted_at:c.created_at,roles:[]}));
      if(!preview.length) preview.push({id:"preview",title:'Indie Feature — "The Long Winter"',type:"Film",location:"New York, NY",union_status:"SAG-AFTRA",pay:"$2,500/week",synopsis:"A character-driven drama about a Brooklyn ceramicist navigating her first gallery show.",slug:"sample",posted_at:new Date().toISOString(),roles:[{name:"NADIA",age_range:"28–38",gender:"Female",pay:"$2,500/week"}]});
      const html=buildEmail("there",preview,"test",slot);
      const r=await sendEmail({from:FROM_EMAIL,to:[to_email],replyTo:CONTACT_EMAIL,subject:subjectFor(slot,preview.length),html});
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
          .select("id,display_name,notification_email,membership_status")
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
    const{data:castings}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).order("created_at",{ascending:false}).limit(500);
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
      const pool=cwr.filter((c:any)=>matches(pf,c));
      const batch=shuffle(pool.slice()).slice(0,JOB_CAP);
      const first=(p.display_name??"").split(" ")[0].trim()||"there";
      outbox.push({ userId:p.id, email, subject:subjectFor(slot,batch.length), html:buildEmail(first,batch,p.id,slot) });
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

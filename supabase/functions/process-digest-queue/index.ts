// process-digest-queue — Supabase Edge Function
// Orchestrates the DAILY casting digest for ALL eligible talent users.
//
// POST { action: "run" }   → match + send digests to every eligible user.
// POST { action: "test", to_email } → preview send (uses send-digest-email).
// GET  ?action=unsubscribe&uid=<id> → unsubscribe + redirect to confirmation.
//
// Reliability notes:
//   • The digest goes out DAILY for the life of the account and never stops on
//     its own. As long as a user has >= 1 matching ACTIVE casting, they get an
//     email — even after they've already been sent every casting in the pool.
//     Newly-posted castings are prioritised; once those run out we recycle ones
//     the user has seen before, SHUFFLED and excluding the exact batch from their
//     last email, so each day's batch differs from the previous send.
//     The number of cards VARIES day-to-day (a cap under 10, not a send-gate), so
//     the digest no longer sends the same fixed count every morning.
//   • Recipient emails come straight from auth.users (get_digest_emails RPC), NOT
//     the GoTrue Admin API — which was silently dropping newer accounts so they
//     never received a digest. Every subscriber, present and future, is covered.
//   • Emails are sent INLINE from this function (direct to Resend/SES). We do NOT
//     fan out one sub-invocation of send-digest-email per user: that hit a per-run
//     ceiling (~60 function-to-function invokes), so the tail of the list — always
//     the NEWEST accounts — silently failed. Inlining removes that ceiling.
//   • last_sent_at is written via UPSERT so the once-per-day gate holds even for
//     users who never had an email_preferences row (otherwise an .update() no-ops
//     and they could be re-emailed on every run).
//   • Expired castings (deadline in the past) are excluded — active only.
//   • Every user outcome (sent/skipped/failed) is written to email_digest_logs
//     with the recipient email + a human reason, so admins can audit who got what.
//   • Each user is isolated in try/catch — one failure never stops the run.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/process-digest-queue`;

// ── Email provider (mirrors send-digest-email): Resend default, SES optional ──
const RESEND_API_KEY        = Deno.env.get("RESEND_API_KEY");
const SENDER_API_KEY        = Deno.env.get("SENDER_API_KEY");
// Forced to Resend: the Sender.net/SES bulk paths are dormant/unverified and were
// silently dropping the daily digest (accepting sends but never delivering). Revert
// this line to `(Deno.env.get("BULK_EMAIL_PROVIDER") ?? Deno.env.get("EMAIL_PROVIDER")
// ?? "resend").toLowerCase()` to restore multi-provider routing.
const EMAIL_PROVIDER        = "resend";
const AWS_ACCESS_KEY_ID     = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const AWS_SES_REGION        = Deno.env.get("AWS_SES_REGION") ?? Deno.env.get("AWS_REGION") ?? "us-east-1";

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
};

function emailConfigured(): boolean {
  if (EMAIL_PROVIDER === "ses")    return !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);
  if (EMAIL_PROVIDER === "sender") return !!SENDER_API_KEY;
  return !!RESEND_API_KEY;
}

interface SendEmailArgs { from:string; to:string[]; subject:string; html:string; text?:string; replyTo?:string; }
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
  if (EMAIL_PROVIDER === "sender") {
    if (!SENDER_API_KEY) return { ok:false, id:null, err:"SENDER_API_KEY not set", status:500 };
    // Sender.net wants {email,name} objects; parse "Name <email>" or a bare address.
    const parseAddr = (s:string) => {
      const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      return m ? { email:m[2].trim(), name:(m[1].replace(/^"|"$/g,"").trim()||undefined) } : { email:s.trim() };
    };
    // deno-lint-ignore no-explicit-any
    const sbody:any = { from:parseAddr(a.from), to:parseAddr(a.to[0]), subject:a.subject, html:a.html };
    if (a.text) sbody.text = a.text;
    const r = await fetch("https://api.sender.net/v2/message/send", {
      method:"POST", headers:{ Authorization:`Bearer ${SENDER_API_KEY}`, "Content-Type":"application/json", Accept:"application/json" }, body:JSON.stringify(sbody),
    });
    if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:(d.message_id ?? d.id ?? null), err:null, status:r.status }; }
    return { ok:false, id:null, err:await r.text(), status:r.status };
  }
  if (!RESEND_API_KEY) return { ok:false, id:null, err:"RESEND_API_KEY not set", status:500 };
  // deno-lint-ignore no-explicit-any
  const body:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
  if (a.text) body.text = a.text;
  if (a.replyTo) body.reply_to = a.replyTo;
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(body),
  });
  if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.id ?? null, err:null, status:r.status }; }
  return { ok:false, id:null, err:await r.text(), status:r.status };
}

function ago(iso: string): string {
  const h = Math.floor((Date.now()-new Date(iso).getTime())/3600000);
  const d = Math.floor(h/24);
  if(h<1) return "Just posted";
  if(h<24) return `${h}h ago`;
  if(d<7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric"});
}

function pill(text: string, bg: string, color: string): string {
  return `<span style="display:inline-block;background:${bg};color:${color};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;margin:0 4px 4px 0;">${text}</span>`;
}

function card(c: any): string {
  const roles  = (c.roles||[]).slice(0,3);
  const more   = Math.max(0,(c.roles||[]).length-3);
  const link   = `${APP_URL}/casting/${c.slug}`;

  const typePill  = c.type         ? pill(c.type.toUpperCase(),"#f0f0ff","#4338ca") : "";
  const unionPill = c.union_status  ? pill(c.union_status,"#f8fafc","#475569")       : "";
  const paidPill  = c.pay          ? pill("$ PAID","#f0fdf4","#15803d")              : pill("DEFERRED","#fefce8","#854d0e");

  const rolesBlock = roles.length ? `
  <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin:10px 0 14px;border-top:1px solid #f1f5f9;">
    ${roles.map((r:any)=>{
      const p=[`<strong style="color:#0f172a;font-size:12px">${r.name||"Role"}</strong>`];
      if(r.age_range) p.push(`<span style="color:#64748b;font-size:12px">${r.age_range}</span>`);
      if(r.gender&&r.gender.toLowerCase()!=="any") p.push(`<span style="color:#64748b;font-size:12px">${r.gender}</span>`);
      if(r.pay) p.push(`<span style="color:#16a34a;font-size:12px;font-weight:600">${r.pay}</span>`);
      return `<tr><td style="padding:5px 0;border-bottom:1px solid #f8fafc;">${p.join(" <span style='color:#cbd5e1'>&middot;</span> ")}</td></tr>`;
    }).join("")}
    ${more>0?`<tr><td style="padding:4px 0;font-size:11px;color:#94a3b8;">+${more} more role${more>1?"s":""}</td></tr>`:""}
  </table>` : "";

  const synopsis = c.synopsis
    ? `<p style="margin:0 0 12px;font-size:13px;color:#64748b;line-height:1.65;">${c.synopsis.slice(0,200)}${c.synopsis.length>200?"&hellip;":""}</p>`
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
      <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:12px;">
        <span style="font-size:11px;color:#94a3b8;">${ago(c.posted_at)}</span>
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

function buildEmail(firstName: string, castings: any[], userId: string, count: number): string {
  const headline  = count===1 ? "1 new casting match for you" : `${count} new casting matches for you`;
  const cards     = castings.map(card).join("");
  const unsub     = `${UNSUB_BASE}?action=unsubscribe&uid=${userId}`;
  const prefs     = `${APP_URL}/account-settings`;
  const browse    = `${APP_URL}/browse-castings`;
  const home      = APP_URL;
  const heroImg    = `${APP_URL}/email/digest-hero.jpg`;
  const logoImgUrl = `${APP_URL}/email/castslate-logo.png`;

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
  .hl{font-size:21px !important;}
  .cards-pad{padding:16px 12px 6px !important;}
  .cta-pad{padding:4px 16px 22px !important;}
  .foot-pad{padding:18px 18px 22px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="wrap" style="background:#f5f5f7;padding:28px 16px;">
<tr><td align="center">

<table width="600" cellpadding="0" cellspacing="0" role="presentation" class="shell" style="background:#ffffff;max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.09);">

<!-- HEADER: dark nav bar -->
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
        <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.4);letter-spacing:1.5px;text-transform:uppercase;">Casting Digest</span>
      </td>
    </tr></table>
  </td>
</tr>

<!-- HERO IMAGE -->
<tr>
  <td style="padding:0;line-height:0;">
    <img src="${heroImg}" width="600" height="220" class="hero-img" alt="New casting roles on CastSlate" style="display:block;width:100%;max-width:600px;height:auto;border:none;outline:none;text-decoration:none;" />
  </td>
</tr>

<!-- HEADLINE -->
<tr>
  <td style="background:#ffffff;padding:26px 28px 22px;text-align:center;border-bottom:1px solid #f1f5f9;">
    <div style="display:inline-block;background:#eef2ff;color:#4338ca;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">${count} New Match${count!==1?"es":""}</div>
    <h1 class="hl" style="margin:0 0 12px;font-size:24px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;line-height:1.25;">${headline}</h1>
    <p style="margin:0 auto;font-size:15px;line-height:1.75;color:#64748b;max-width:440px;">Hi ${firstName} &mdash; fresh projects matched to your profile, location, and casting preferences. Review and submit while the roles are still open.</p>
  </td>
</tr>

<!-- CASTING CARDS -->
<tr>
  <td class="cards-pad" style="background:#f8fafc;padding:20px 18px 8px;">
    ${cards}
  </td>
</tr>

<!-- BROWSE CTA -->
<tr>
  <td class="cta-pad" style="background:#f8fafc;padding:4px 28px 26px;text-align:center;">
    <a href="${browse}" style="display:inline-block;background:#37696A;color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:9px;font-size:14px;font-weight:700;letter-spacing:0.1px;border:2px solid #37696A;">Browse All Castings</a>
  </td>
</tr>

<!-- DIVIDER -->
<tr><td style="padding:0 24px;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>

<!-- FOOTER -->
<tr>
  <td class="foot-pad" style="background:#ffffff;padding:20px 28px 24px;">
    <p style="margin:0 0 10px;font-size:12px;color:#94a3b8;line-height:1.8;">You're receiving this because you signed up for CastSlate casting recommendations.</p>
    <p style="margin:0 0 14px;font-size:12px;line-height:1.6;">
      <a href="${prefs}" style="color:#4338ca;text-decoration:none;font-weight:600;">Manage preferences</a>
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

function eligible(freq: string, lastSent: string|null): boolean {
  if(freq==="off") return false;
  if(!lastSent) return true;
  const h=(Date.now()-new Date(lastSent).getTime())/3600000;
  return freq==="daily"?h>=20:freq==="every_other_day"?h>=44:freq==="weekly"?h>=164:false;
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

serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});

  // Unsubscribe via GET — update DB then redirect to the SPA confirmation page
  if(req.method==="GET"){
    const url=new URL(req.url);
    if(url.searchParams.get("action")==="unsubscribe"&&url.searchParams.get("uid")){
      const uid=url.searchParams.get("uid")!;
      const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);
      await sb.from("email_preferences").upsert(
        {user_id:uid,casting_digest_enabled:false,unsubscribed_at:new Date().toISOString(),updated_at:new Date().toISOString()},
        {onConflict:"user_id"}
      );
      return new Response(null,{ status:302, headers:{"Location":`${APP_URL}/unsubscribed`} });
    }
    return new Response("Not found",{status:404});
  }

  const res=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});

  try{
    const body=await req.json();
    const{action,to_email}=body;
    const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);

    // Non-fatal logging helper — a logging failure must never abort the run.
    const logRow=async(row:Record<string,unknown>)=>{
      try{ await sb.from("email_digest_logs").insert(row); }catch(e){ console.error("[digest-queue] log insert failed",e); }
    };

    if(action==="test"){
      if(!to_email) return res({error:"to_email required"},400);
      const today=new Date().toISOString().slice(0,10);
      const{data:cs}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).order("created_at",{ascending:false}).limit(5);
      const preview=(cs||[]).map((c:any)=>({...c,posted_at:c.created_at,roles:[]}));
      if(!preview.length) preview.push({id:"preview",title:"Indie Feature — New York",type:"Film",location:"New York, NY",union_status:"SAG-AFTRA",pay:"$2,500/week",synopsis:"A quiet drama about a Brooklyn ceramicist navigating her first gallery show. Character-driven, single-location, real-world cast.",slug:"sample",posted_at:new Date().toISOString(),roles:[{name:"NADIA",age_range:"28–38",gender:"Female",pay:"$2,500/week"}]});
      if(!emailConfigured()) return res({error:"Email provider not configured"},500);
      const count=preview.length;
      const subject=count===1?"1 new casting match on CastSlate":`${count} new casting matches on CastSlate`;
      const html=buildEmail("there",preview,"test",count);
      const r=await sendEmail({from:FROM_EMAIL,to:[to_email],replyTo:CONTACT_EMAIL,subject,html});
      if(!r.ok) return res({error:r.err},500);
      return res({ok:true,result:{status:"sent",provider_id:r.id}});
    }

    if(action==="run"){
      const{data:cfg}=await sb.from("site_settings").select("digest_emails_enabled,digest_min_projects,digest_paused").eq("id",1).maybeSingle();
      if(!cfg?.digest_emails_enabled||cfg.digest_paused) return res({ok:false,message:cfg?.digest_paused?"Paused":"Disabled",sent:0,skipped:0});
      if(!emailConfigured()) return res({ok:false,message:"Email provider not configured",sent:0,skipped:0},500);

      // How many castings go in each email. Instead of a FIXED number every day
      // (which felt repetitive), the count VARIES day-to-day for variety. It is
      // deterministic per calendar day — the same value for the whole run, so every
      // user gets the same-sized digest that morning — and walks a hand-picked cycle
      // with good spread, no back-to-back repeats, all under 10.
      //   This is still a CAP, not a send-gate: if a user has fewer matching active
      //   castings than today's number, they simply get however many they have.
      const DAILY_COUNTS=[4,6,3,7,2,5,3,8,4,6,2,7,5,3];
      const epochDay=Math.floor(Date.now()/86400000);   // days since 1970 (UTC)
      const cap=DAILY_COUNTS[epochDay % DAILY_COUNTS.length];

      // ── Load ALL active, visible talent profiles (paginated — no 1000 cap) ───
      const profiles:any[]=[];
      {
        const PAGE=1000; let from=0;
        while(true){
          const{data,error}=await sb.from("profiles")
            .select("id,display_name,notification_email")
            .in("user_type",["talent","actor"])
            .eq("account_status","active")
            .eq("visible",true)
            .order("created_at",{ascending:true})
            .range(from,from+PAGE-1);
          if(error){ console.error("[digest-queue] profiles page error",error); break; }
          if(!data?.length) break;
          profiles.push(...data);
          if(data.length<PAGE) break;
          from+=PAGE;
        }
      }
      if(!profiles.length) return res({ok:true,message:"No eligible users",sent:0,skipped:0});

      const uids=profiles.map((p:any)=>p.id);

      // ── Email preferences for those users ───────────────────────────────────
      const pm:Record<string,any>={};
      {
        const CH=300;
        for(let i=0;i<uids.length;i+=CH){
          const{data:prefs}=await sb.from("email_preferences").select("*").in("user_id",uids.slice(i,i+CH));
          (prefs||[]).forEach((p:any)=>{pm[p.user_id]=p;});
        }
      }

      // ── Recipient emails — resolved DIRECTLY from auth.users via the
      //    get_digest_emails RPC (SECURITY DEFINER). We deliberately do NOT use
      //    the GoTrue Admin API (listUsers/getUserById) here: it was silently
      //    failing to return newer accounts, so those subscribers never got a
      //    digest. Reading auth.users straight is authoritative and covers every
      //    subscriber — present and future.
      const emailMap:Record<string,string>={};
      {
        const CH=1000;
        for(let i=0;i<uids.length;i+=CH){
          const{data,error}=await sb.rpc("get_digest_emails",{uids:uids.slice(i,i+CH)});
          if(error){ console.error("[digest-queue] get_digest_emails error",error); continue; }
          (data||[]).forEach((r:any)=>{ if(r?.id&&r?.email) emailMap[r.id]=r.email; });
        }
      }

      // ── All open, published, NON-EXPIRED castings (recent first) + roles ──────
      const today=new Date().toISOString().slice(0,10);
      const{data:castings}=await sb.from("castings").select("id,title,type,location,union_status,pay,synopsis,slug,created_at,deadline").eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`).order("created_at",{ascending:false}).limit(500);
      if(!castings?.length) return res({ok:true,message:"No active castings",sent:0,skipped:0});
      const cids=castings.map((c:any)=>c.id);
      const rb:Record<string,any[]>={};
      {
        const CH=200;
        for(let i=0;i<cids.length;i+=CH){
          const{data:roles}=await sb.from("roles").select("id,casting_id,name,age_range,gender,pay").in("casting_id",cids.slice(i,i+CH));
          (roles||[]).forEach((r:any)=>{if(!rb[r.casting_id])rb[r.casting_id]=[];rb[r.casting_id].push(r);});
        }
      }
      const cwr=castings.map((c:any)=>({...c,posted_at:c.created_at,roles:rb[c.id]||[]}));

      let sent=0, skipped=0, failed=0;
      const skipReasons:Record<string,number>={};
      const errs:string[]=[];
      const bump=(reason:string)=>{ skipReasons[reason]=(skipReasons[reason]||0)+1; };

      for(const p of profiles){
        const email=emailMap[p.id]||null;
        try{
          const pf=pm[p.id]??{};

          // ── Eligibility gates (with explicit reasons) ───────────────────────
          let skipReason:string|null=null;
          if(pf.casting_digest_enabled===false)      skipReason="digest_disabled";
          else if(pf.unsubscribed_at)                skipReason="unsubscribed";
          else if(p.notification_email===false)      skipReason="email_notifications_off";
          else if((pf.frequency||"daily")==="off")   skipReason="frequency_off";
          else if(!eligible(pf.frequency||"daily",pf.last_sent_at??null)) skipReason="sent_recently";
          else if(!email)                            skipReason="no_email";

          if(skipReason){ skipped++; bump(skipReason); await logRow({user_id:p.id,email,status:"skipped",reason:skipReason,project_ids_included:[]}); continue; }

          // ── Pick this user's castings ───────────────────────────────────────
          //    The digest must keep going out DAILY for the life of the account —
          //    it must NOT stop once a user has already been emailed every casting.
          //      1. all matching ACTIVE castings = the pool,
          //      2. prefer ones they've never been emailed (fresh),
          //      3. then recycle ones they've seen before, EXCLUDING the exact
          //         batch from their last email so today's batch always differs,
          //      4. shuffle so the daily mix varies,
          //    and we only skip when the pool is genuinely empty.
          const pool=cwr.filter((c:any)=>matches(pf,c));
          if(pool.length<1){ skipped++; bump("no_matches"); await logRow({user_id:p.id,email,status:"skipped",reason:"no_matches",project_ids_included:[]}); continue; }

          let sentIds=new Set<string>();
          try{
            const{data:hist}=await sb.from("user_casting_email_history").select("casting_id").eq("user_id",p.id);
            sentIds=new Set((hist||[]).map((h:any)=>h.casting_id));
          }catch(e){ console.error("[digest-queue] history fetch failed",p.id,e); }

          let lastIds=new Set<string>();
          try{
            const{data:last}=await sb.from("email_digest_logs").select("project_ids_included").eq("user_id",p.id).eq("status","sent").order("sent_at",{ascending:false}).limit(1).maybeSingle();
            lastIds=new Set(((last?.project_ids_included)||[]) as string[]);
          }catch(e){ console.error("[digest-queue] last-batch fetch failed",p.id,e); }

          const shuffle=(arr:any[])=>{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; };
          const fresh=shuffle(pool.filter((c:any)=>!sentIds.has(c.id)));
          const recycled=shuffle(pool.filter((c:any)=>sentIds.has(c.id)&&!lastIds.has(c.id)));
          let candidates=[...fresh,...recycled];
          if(candidates.length<1) candidates=shuffle(pool.slice());

          // ── Send INLINE (direct to Resend/SES — no per-user sub-invocation). ──
          const batch=candidates.slice(0,cap);
          const first=(p.display_name??"").split(" ")[0].trim()||"there";
          const count=batch.length;
          const subject=count===1?"1 new casting match on CastSlate":`${count} new casting matches on CastSlate`;
          const html=buildEmail(first,batch,p.id,count);
          const r=await sendEmail({from:FROM_EMAIL,to:[email],replyTo:CONTACT_EMAIL,subject,html});

          if(r.ok){
            sent++;
            await logRow({user_id:p.id,email,status:"sent",reason:`Sent ${count} match${count!==1?"es":""}`,provider_message_id:r.id,project_ids_included:batch.map((c:any)=>c.id)});
            // Record what they've seen + stamp last_sent_at (UPSERT so the daily
            // gate holds even when the user has no email_preferences row yet).
            await sb.from("user_casting_email_history").upsert(batch.map((c:any)=>({user_id:p.id,casting_id:c.id})),{onConflict:"user_id,casting_id",ignoreDuplicates:true});
            await sb.from("email_preferences").upsert({user_id:p.id,last_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"user_id"});
          }else{
            failed++; errs.push(`${p.id}: ${r.err}`);
            await logRow({user_id:p.id,email,status:"failed",reason:"Email send failed",error_message:r.err,project_ids_included:batch.map((c:any)=>c.id)});
          }
        }catch(e){
          failed++; errs.push(`${p.id}: ${String(e)}`);
          await logRow({user_id:p.id,email,status:"failed",reason:"unexpected_error",error_message:String(e),project_ids_included:[]});
        }
        // Respect Resend's rate limit (~2 req/s) — direct sends, no invoke overhead.
        await new Promise(r=>setTimeout(r,550));
      }

      const summary={ok:true,sent,skipped,failed,total_users:profiles.length,skip_reasons:skipReasons,errors:errs.length?errs.slice(0,50):undefined};
      console.log("[digest-queue] run complete",JSON.stringify(summary));
      return res(summary);
    }

    return res({error:"Unknown action"},400);
  }catch(e){
    console.error("[digest-queue]",e);
    return res({error:String(e)},500);
  }
});

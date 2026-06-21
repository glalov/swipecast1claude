import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
// Single source of truth for the public contact address shown in every email.
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/process-digest-queue`;

// ─────────────────────────────────────────────────────────────────────────────
// Email provider abstraction. Defaults to Resend; set EMAIL_PROVIDER="ses" to
// route every send through Amazon SES (v2 API, SigV4-signed). Switching is a
// pure config change — no redeploy needed — and Resend stays as instant fallback.
// SES secrets (only read when active): AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
// AWS_SES_REGION (falls back to AWS_REGION, then "us-east-1").
// ─────────────────────────────────────────────────────────────────────────────
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

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
};

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
  // Email-safe imagery: self-hosted on the CastSlate domain (public, no auth, no
  // expiring signed URLs, no third-party host that Zoho/Outlook proxies may block).
  // NOTE: no "?v=" query string — some image proxies (Zoho) fail to fetch URLs
  // with query params, which left the hero showing as a broken image. The /email/
  // assets are served immutable, so cache-busting is done by renaming the file.
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
              <!-- Logo: self-hosted CastSlate PNG — absolute HTTPS, email-safe img tag -->
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

serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const jsonR=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
  try{
    const body=await req.json();
    const{user_id,to_email,castings,is_test}=body;
    if(!castings?.length) return jsonR({error:"No castings"},400);
    if(!emailConfigured()) return jsonR({error:"Email provider not configured"},500);
    const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY);
    let email=to_email??null, first="there";
    if(user_id&&!is_test){
      const{data:a}=await sb.auth.admin.getUserById(user_id);
      if(!a?.user?.email) return jsonR({error:"User not found"},404);
      email=a.user.email;
      const{data:p}=await sb.from("profiles").select("display_name").eq("id",user_id).maybeSingle();
      first=(p?.display_name??"").split(" ")[0].trim()||"there";
    }
    if(!email) return jsonR({error:"No recipient"},400);
    const count=castings.length;
    const subject=count===1?"1 new casting match on CastSlate":`${count} new casting matches on CastSlate`;
    const html=buildEmail(first,castings,user_id??"test",count);
    const sent=await sendEmail({from:FROM_EMAIL,to:[email],replyTo:CONTACT_EMAIL,subject,html});
    const pid=sent.id, status=sent.ok?"sent":"failed", err=sent.err;
    if(!sent.ok) console.error("[digest-email]",err);
    if(user_id&&!is_test){
      await sb.from("email_digest_logs").insert({user_id,email,project_ids_included:castings.map((c:any)=>c.id),status,reason:status==="sent"?`Sent ${count} match${count!==1?"es":""}`:"Email send failed",provider_message_id:pid,error_message:err});
      if(status==="sent"){
        await sb.from("user_casting_email_history").upsert(castings.map((c:any)=>({user_id,casting_id:c.id})),{onConflict:"user_id,casting_id",ignoreDuplicates:true});
        await sb.from("email_preferences").update({last_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("user_id",user_id);
      }
    }
    return jsonR({ok:status==="sent",status,provider_id:pid,error:err});
  }catch(e){
    console.error("[digest-email]",e);
    return jsonR({error:String(e)},500);
  }
});

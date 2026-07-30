// winback-run — Supabase Edge Function
// Abandoned-checkout win-back sequence for NON-PREMIUM users who reached Stripe
// checkout (have a checkout_consents row) but never completed.
//
// POST { action:"run", secret }                    → send every DUE user their next step.
// POST { action:"run", secret, test_override_email}→ real per-user build, ALL sends
//                                                    redirected to that address (no logs).
// POST { action:"run", secret, only_user_id }      → process just that user (test).
// POST { action:"test", secret, to_email }         → send all 3 sample designs to to_email.
// GET/POST ?action=unsubscribe&uid=<id>            → opt out of THIS campaign only.
//
// Rotation (by number of prior 'sent' logs):
//   0 → ① "One step away"  (fires ~1h after the abandoned attempt; hourly cron)
//   1 → ② "Locked out"     (a week after ①)
//  ≥2 → ③ "Founder note"   (a week later, then repeats weekly)
//
// Safety mirrors weekly-upsell: premium excluded by query + in-loop backstop,
// email_unsubscribes suppression, per-campaign opt-out, feature-flag gating,
// every send logged. Sends via Resend batch. All CTAs point at /membership.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/winback-run`;
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "cmpn_9e872b254fab6297129ac7ee95c021831a2163dd1f7a9906";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const LOGO_URL             = `${APP_URL}/email/castslate-logo.png`;
const CTA_URL              = `${APP_URL}/membership`;

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, GET, OPTIONS",
};

function esc(s: unknown): string { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

interface SendArgs { to:string[]; subject:string; html:string; headers?:Record<string,string>; }
interface SendResult { ok:boolean; id:string|null; err:string|null; }

async function sendBatch(items: SendArgs[]): Promise<SendResult[]> {
  if (!RESEND_API_KEY) return items.map(()=>({ ok:false, id:null, err:"RESEND_API_KEY not set" }));
  const payload = items.map((a)=>({ from:FROM_EMAIL, to:a.to, subject:a.subject, html:a.html, reply_to:CONTACT_EMAIL, headers:a.headers }));
  try {
    const r = await fetch("https://api.resend.com/emails/batch", { method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(payload) });
    if (r.ok) { const d = await r.json().catch(()=>({} as any)); const arr:any[] = Array.isArray((d as any)?.data) ? (d as any).data : []; return items.map((_,i)=>({ ok:true, id:arr[i]?.id ?? null, err:null })); }
    const t = await r.text(); return items.map(()=>({ ok:false, id:null, err:t }));
  } catch (e) { return items.map(()=>({ ok:false, id:null, err:String(e) })); }
}

// ── Shared bits ──
function logoTile(dark: boolean): string {
  // White tile with the real arrow. On light cards it gets a dark outline so it
  // doesn't fade into the background; on the dark card no outline is needed.
  const border = dark ? "" : "border:2px solid #1a1b2e;box-sizing:border-box;";
  return `<span style="display:inline-block;width:42px;height:42px;border-radius:10px;background:#ffffff;${border}text-align:center;line-height:38px;vertical-align:middle;"><img src="${LOGO_URL}" width="34" height="34" alt="CastSlate" style="vertical-align:middle;border:none;"/></span>`;
}
function docShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f0f4f4;-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f0f4f4;padding:30px 12px;"><tr><td align="center">
${inner}
</td></tr></table></body></html>`;
}
function footerUnsub(uid: string, dark: boolean): string {
  const col = dark ? "#b8bcca" : "#b0a894";
  return `<a href="${UNSUB_BASE}?action=unsubscribe&uid=${encodeURIComponent(uid)}" style="color:${col};text-decoration:underline;">Unsubscribe</a>`;
}

// ── ① One step away (light, teal, outlined) ──
function email1(firstName: string, uid: string, planLabel: string, planOffer: string): string {
  const inner = `<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:100%;background:#f7f5f0;border:2px solid #1a1b2e;border-radius:18px;overflow:hidden;">
  <tr><td style="background:#1a1b2e;padding:16px 26px;border-radius:16px 16px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td style="vertical-align:middle;">${logoTile(true)}&nbsp;&nbsp;<span style="font-size:19px;font-weight:800;color:#fff;letter-spacing:-0.4px;vertical-align:middle;">CastSlate</span></td>
      <td style="text-align:right;"><span style="font-size:10px;font-weight:700;color:#9296a6;letter-spacing:1.6px;text-transform:uppercase;">Almost there</span></td>
    </tr></table></td></tr>
  <tr><td style="background:#1a1b2e;padding:6px 34px 38px;text-align:center;">
    <div style="display:inline-block;background:rgba(212,163,74,0.16);color:#e0b866;padding:5px 15px;border-radius:30px;font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;margin-bottom:20px;border:1px solid rgba(212,163,74,0.32);">&#9203;&nbsp; You left something behind</div>
    <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;color:#fff;letter-spacing:-0.5px;line-height:1.2;">You were one step<br/>from Premium, ${esc(firstName)}.</h1>
    <p style="margin:0 auto;font-size:16px;line-height:1.7;color:#ccd0da;max-width:420px;">Your ${esc(planLabel)} is still sitting in checkout. It takes about 20 seconds to finish &mdash; your details are already there.</p></td></tr>
  <tr><td style="background:#f7f5f0;padding:30px 34px 6px;">
    <div style="font-size:12px;font-weight:800;color:#37696A;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Your signup &middot; 90% complete</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#e4ddcf;border-radius:20px;overflow:hidden;"><tr><td style="height:12px;width:90%;background:#37696A;border-radius:20px;"></td><td style="width:10%;"></td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:14px;"><tr>
      <td style="font-size:13px;color:#37696A;font-weight:700;">&#10003; Account created</td>
      <td style="font-size:13px;color:#37696A;font-weight:700;text-align:center;">&#10003; Plan chosen</td>
      <td style="font-size:13px;color:#b8b09d;font-weight:700;text-align:right;">&#9675; Confirm payment</td>
    </tr></table></td></tr>
  <tr><td style="background:#f7f5f0;padding:24px 34px 10px;text-align:center;">
    <a href="${CTA_URL}" style="display:inline-block;background:#37696A;color:#fff;text-decoration:none;padding:16px 44px;border-radius:11px;font-size:15px;font-weight:800;box-shadow:0 6px 18px rgba(55,105,106,0.32);">Finish &amp; unlock Premium &rarr;</a>
    <div style="margin-top:12px;font-size:12px;color:#a49c8a;">${esc(planOffer)} &middot; Nothing charged until you confirm</div></td></tr>
  <tr><td style="background:#f7f5f0;padding:8px 34px 30px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border:1px solid #e4ddcf;border-radius:14px;"><tr>
      <td style="width:4px;background:#e0b866;" width="4"></td>
      <td style="padding:16px 18px;"><div style="font-size:14px;color:#5f5a4e;line-height:1.6;">Free members get <b style="color:#1a1b2e;">one</b> submission a week. Premium members applied to <b style="color:#1a1b2e;">every</b> casting the moment it posted &mdash; first in line, seen first.</div></td>
    </tr></table></td></tr>
  <tr><td style="background:#1a1b2e;padding:22px 34px;text-align:center;border-radius:0 0 16px 16px;">
    <div style="font-size:12px;color:#9a9db0;line-height:1.6;">CastSlate &middot; Your career, one link.<br/>${footerUnsub(uid,true)}</div></td></tr>
  </table>`;
  return docShell(`You were one step from Premium, ${firstName}`, inner);
}

// ── ② Locked out (dark, amber) ──
function email2(firstName: string, uid: string, attempts: number, castings: {title:string;meta:string}[], moreCount: number): string {
  const rows = castings.map((c)=>`<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#1b1c27;border:1px solid rgba(255,255,255,0.07);border-radius:12px;margin-bottom:10px;"><tr>
      <td style="width:4px;background:#3a3b48;" width="4"></td>
      <td style="padding:15px 16px;"><div style="font-size:15px;font-weight:800;color:#8f8a7d;letter-spacing:0.3px;">${esc(c.title)} &nbsp;&bull;&bull;&bull;&bull;</div><div style="font-size:12px;color:#6a6656;margin-top:3px;">&#128274; ${esc(c.meta)}</div></td>
      <td style="text-align:right;padding-right:16px;"><span style="font-size:20px;">&#128274;</span></td>
    </tr></table>`).join("");
  const more = moreCount>0 ? `<div style="text-align:center;padding:6px 0 2px;"><span style="font-size:13px;color:#6a6656;font-weight:600;">+ ${moreCount} more role${moreCount!==1?"s":""} you couldn't submit to this week</span></div>` : "";
  const intro = attempts>=3
    ? `You've opened checkout <b style="color:#e0b866;">${attempts} times</b>. Meanwhile these roles went live this week &mdash; and Premium members were first in line for every one.`
    : `You started signing up for Premium but didn't finish. Meanwhile these roles went live this week &mdash; and Premium members were first in line for every one.`;
  const head = attempts>=3 ? `You keep coming back,<br/>${esc(firstName)}. So does the work.` : `${esc(firstName)}, the work<br/>didn't wait for you.`;
  const inner = `<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:100%;background:#12131c;border-radius:18px;overflow:hidden;">
  <tr><td style="padding:18px 26px;border-bottom:1px solid rgba(255,255,255,0.08);">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td>${logoTile(true)}&nbsp;&nbsp;<span style="font-size:19px;font-weight:800;color:#fff;vertical-align:middle;">CastSlate</span></td>
      <td style="text-align:right;"><span style="font-size:10px;font-weight:700;color:#e0b866;letter-spacing:1.6px;text-transform:uppercase;">Premium locked</span></td>
    </tr></table></td></tr>
  <tr><td style="padding:34px 34px 22px;text-align:center;">
    <div style="font-size:44px;margin-bottom:8px;">&#128274;</div>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#fff;letter-spacing:-0.4px;line-height:1.22;">${head}</h1>
    <p style="margin:0 auto;font-size:15px;line-height:1.7;color:#c3c6d1;max-width:420px;">${intro}</p></td></tr>
  <tr><td style="padding:6px 30px 4px;">${rows}${more}</td></tr>
  <tr><td style="padding:24px 34px 8px;text-align:center;">
    <a href="${CTA_URL}" style="display:inline-block;background:#e0b866;color:#12131c;text-decoration:none;padding:16px 46px;border-radius:11px;font-size:15px;font-weight:800;box-shadow:0 6px 22px rgba(224,184,102,0.28);">Unlock every casting &rarr;</a>
    <div style="margin-top:12px;font-size:12px;color:#8f92a4;">Plans from $8.25/mo &middot; unlimited submissions</div></td></tr>
  <tr><td style="padding:22px 34px 30px;text-align:center;">
    <div style="border-top:1px solid #2c2d3a;padding-top:16px;font-size:12px;color:#a6a9b8;">You reached Premium checkout on CastSlate. ${footerUnsub(uid,true)}</div></td></tr>
  </table>`;
  return docShell(`${firstName}, these castings went live without you`, inner);
}

// ── ③ Founder note (light cream, outlined) ──
function email3(firstName: string, uid: string): string {
  const inner = `<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:100%;background:#faf8f3;border:2px solid #1a1b2e;border-radius:18px;overflow:hidden;">
  <tr><td style="padding:26px 40px 6px;">${logoTile(false)}&nbsp;&nbsp;<span style="font-size:16px;font-weight:800;color:#1a1b2e;vertical-align:middle;letter-spacing:-0.2px;">CastSlate</span></td></tr>
  <tr><td style="padding:22px 40px 6px;">
    <h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:#1a1b2e;letter-spacing:-0.3px;line-height:1.3;">A quick note, ${esc(firstName)} &mdash;</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.72;color:#413d34;">I noticed you started signing up for Premium but didn't finish. No pressure at all &mdash; I just wanted to make sure nothing broke on our end.</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.72;color:#413d34;">Here's the honest pitch: free accounts get one submission a week. That's fine to test the waters, but the actors booking work are the ones applying the day a role drops &mdash; and that's what Premium unlocks. Unlimited submissions, every casting the moment it posts, and your shareable TapeLink card.</p>
    <p style="margin:0 0 22px;font-size:16px;line-height:1.72;color:#413d34;">Whenever you're ready, it's right here. Takes about 20 seconds and you're in.</p></td></tr>
  <tr><td style="padding:0 40px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border:1px solid #e7e0d1;border-radius:14px;"><tr>
      <td style="width:4px;background:#37696A;" width="4"></td>
      <td style="padding:18px 20px;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td><div style="font-size:12px;color:#9a9384;">CastSlate Premium</div><div style="font-size:24px;font-weight:800;color:#1a1b2e;letter-spacing:-0.5px;">$8.25 <span style="font-size:13px;font-weight:600;color:#9a9384;">/ month billed yearly</span></div></td>
        <td style="text-align:right;"><span style="display:inline-block;background:#eaf1f0;color:#37696A;font-size:11px;font-weight:800;padding:5px 11px;border-radius:20px;letter-spacing:0.4px;">Unlimited submissions</span></td>
      </tr></table></td></tr></table></td></tr>
  <tr><td style="padding:20px 40px 6px;text-align:center;">
    <a href="${CTA_URL}" style="display:inline-block;background:#1a1b2e;color:#fff;text-decoration:none;padding:15px 44px;border-radius:11px;font-size:15px;font-weight:800;">Finish signing up &rarr;</a></td></tr>
  <tr><td style="padding:20px 40px 30px;">
    <div style="border-top:1px solid #e7e0d1;padding-top:18px;font-size:15px;line-height:1.6;color:#413d34;">Either way, glad you're here.<br/><span style="font-family:Georgia,serif;font-style:italic;font-size:17px;color:#1a1b2e;">&mdash; The CastSlate Team</span></div>
    <div style="margin-top:16px;font-size:12px;color:#b0a894;">You're getting this because you started a Premium signup. ${footerUnsub(uid,false)}</div></td></tr>
  </table>`;
  return docShell(`A quick note, ${firstName}`, inner);
}

function firstNameOf(displayName: unknown): string { return String(displayName ?? "").split(" ")[0].trim() || "there"; }
function planLabelOf(planKey: unknown): string {
  const k = String(planKey ?? "monthly").toLowerCase();
  if (k.includes("year") || k.includes("annual")) return "yearly plan";
  if (k.includes("six") || k.includes("6")) return "6-month plan";
  return "monthly plan";
}
function planOfferOf(planKey: unknown): string {
  const k = String(planKey ?? "monthly").toLowerCase();
  if (k.includes("year") || k.includes("annual")) return "$99/year · same price every year";
  if (k.includes("six") || k.includes("6")) return "$89.70 every 6 months · $14.95/month";
  return "$19.95/month · cancel anytime";
}
function subjectFor(step: number, firstName: string): string {
  if (step===1) return `You were one step from Premium, ${firstName}`;
  if (step===2) return `${firstName}, these castings went live without you`;
  return `A quick note, ${firstName} — CastSlate`;
}
function buildFor(step: number, firstName: string, uid: string, planLabel: string, planOffer: string, attempts: number, castings: {title:string;meta:string}[], moreCount: number): string {
  if (step===1) return email1(firstName, uid, planLabel, planOffer);
  if (step===2) return email2(firstName, uid, attempts, castings, moreCount);
  return email3(firstName, uid);
}

serve(async (req) => {
  if (req.method==="OPTIONS") return new Response("ok",{headers:cors});
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Unsubscribe (GET link + RFC 8058 one-click POST) — before any req.json().
  {
    const url = new URL(req.url);
    if ((req.method==="GET"||req.method==="POST") && url.searchParams.get("action")==="unsubscribe" && url.searchParams.get("uid")) {
      const uid = url.searchParams.get("uid")!;
      const { data: existing } = await sb.from("email_preferences").select("winback_optout").eq("user_id",uid).maybeSingle();
      await sb.from("email_preferences").upsert({ user_id:uid, winback_optout:true, updated_at:new Date().toISOString() }, { onConflict:"user_id" });
      if (!existing || existing.winback_optout!==true) { try { await sb.from("winback_logs").insert({ user_id:uid, status:"skipped", reason:"unsubscribe_click" }); } catch(_) {} }
      return req.method==="GET"
        ? new Response(null,{ status:302, headers:{...cors,"Location":`${APP_URL}/unsubscribed`} })
        : new Response(JSON.stringify({ok:true,unsubscribed:true}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
    }
    if (req.method==="GET") return new Response("Not found",{status:404});
  }

  const res = (b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});

  try {
    const body = await req.json();
    const { action, secret, to_email } = body;

    let authorized = !!secret && (secret===SUPABASE_SERVICE_KEY || (ADMIN_SECRET && secret===ADMIN_SECRET));
    if (!authorized) {
      const authz = req.headers.get("Authorization")||"";
      if (authz.startsWith("Bearer ")) {
        try { const { data:{ user } } = await sb.auth.getUser(authz.slice(7));
          if (user) { const { data:prof } = await sb.from("profiles").select("user_type").eq("id",user.id).maybeSingle(); if (prof && ["admin","super_admin"].includes(prof.user_type)) authorized=true; } } catch(_) {}
      }
    }
    if (!authorized) return res({error:"Unauthorized"},401);
    if (!RESEND_API_KEY) return res({error:"Email provider not configured"},500);

    // Real recent castings for ② (2 shown + more count). Non-fatal if empty.
    async function lockedCastings(): Promise<{list:{title:string;meta:string}[]; more:number}> {
      const today = new Date().toISOString().slice(0,10);
      const { data } = await sb.from("castings").select("title,location,pay,union_status,created_at,deadline")
        .eq("status","open").eq("published",true).or(`deadline.is.null,deadline.gte.${today}`)
        .order("created_at",{ascending:false}).limit(20);
      const all = (data||[]).map((c:any)=>({ title:c.title, meta:[c.location||"Location TBD", c.union_status, c.pay?"Paid":null].filter(Boolean).join(" · ") }));
      return { list: all.slice(0,2), more: Math.max(0, all.length-2) };
    }

    // ── TEST: all 3 sample designs to one address ──
    if (action==="test") {
      if (!to_email) return res({error:"to_email required"},400);
      const { list, more } = await lockedCastings();
      const cast = list.length ? list : [{title:"Netflix Feature — Supporting Lead",meta:"Los Angeles · SAG-AFTRA · Rate hidden"},{title:"National Commercial — Principal",meta:"Remote self-tape · Paid"}];
      const items:SendArgs[] = [
        { to:[to_email], subject:subjectFor(1,"there"), html:email1("there","test-uid","monthly plan","$19.95/month · cancel anytime") },
        { to:[to_email], subject:subjectFor(2,"there"), html:email2("there","test-uid",9,cast,more||14) },
        { to:[to_email], subject:subjectFor(3,"there"), html:email3("there","test-uid") },
      ];
      const r = await sendBatch(items);
      return res({ ok:true, test:true, to:to_email, results:r });
    }

    if (action!=="run") return res({error:"Unknown action"},400);

    const overrideEmail = (body.test_override_email??"").toString().trim().toLowerCase() || null;
    const onlyUserId    = (body.only_user_id??"").toString().trim() || null;
    const isDryTest     = !!overrideEmail || !!onlyUserId;

    if (!isDryTest) {
      const { data:cfg } = await sb.from("site_settings").select("winback_enabled,winback_paused").eq("id",1).maybeSingle();
      if (cfg && cfg.winback_enabled===false) return res({ok:false,message:"Disabled",sent:0,skipped:0});
      if (cfg && cfg.winback_paused===true)   return res({ok:false,message:"Paused",sent:0,skipped:0});
    }

    // Candidate audience (non-premium + has consent + not opted out).
    let { data:cands, error:candErr } = await sb.rpc("winback_candidates");
    if (candErr) return res({error:"candidates rpc: "+candErr.message},500);
    let candidates:any[] = cands||[];
    if (onlyUserId) candidates = candidates.filter((c:any)=>c.user_id===onlyUserId);
    if (!candidates.length) return res({ok:true,message:"No eligible users",sent:0,skipped:0});

    const uids = candidates.map((c:any)=>c.user_id);

    // Resolve emails (auth.users) via the shared RPC.
    const emailMap:Record<string,string> = {};
    { const CH=1000; for (let i=0;i<uids.length;i+=CH) { const { data } = await sb.rpc("get_digest_emails",{uids:uids.slice(i,i+CH)}); (data||[]).forEach((r:any)=>{ if(r?.id&&r?.email) emailMap[r.id]=r.email; }); } }

    // Global suppression (hard bounces / complaints).
    const suppressed = new Set<string>();
    { const PAGE=1000; let from=0; while(true){ const { data } = await sb.from("email_unsubscribes").select("email").range(from,from+PAGE-1); if(!data?.length) break; data.forEach((r:any)=>{ if(r.email) suppressed.add(String(r.email).trim().toLowerCase()); }); if(data.length<PAGE) break; from+=PAGE; } }

    const now = Date.now();
    const HOUR = 3600*1000, WEEK = 7*86400*1000;
    const { list:castList, more:castMore } = await lockedCastings();

    interface Out { userId:string; email:string; step:number; subject:string; html:string; }
    const outbox:Out[] = [];
    const logs:Record<string,unknown>[] = [];
    let sent=0, skipped=0, failed=0;
    const skipReasons:Record<string,number> = {};
    const bump=(r:string)=>{ skipReasons[r]=(skipReasons[r]||0)+1; };

    for (const c of candidates) {
      const email = overrideEmail || emailMap[c.user_id] || null;
      if (c.notification_email===false) { skipped++; bump("email_notifications_off"); if(!isDryTest) logs.push({user_id:c.user_id,status:"skipped",reason:"email_notifications_off"}); continue; }
      if (!email)                       { skipped++; bump("no_email"); if(!isDryTest) logs.push({user_id:c.user_id,status:"skipped",reason:"no_email"}); continue; }
      if (!overrideEmail && suppressed.has(String(email).trim().toLowerCase())) { skipped++; bump("suppressed"); if(!isDryTest) logs.push({user_id:c.user_id,email,status:"skipped",reason:"suppressed"}); continue; }

      // Decide step + whether due.
      const sentCount = Number(c.sent_count)||0;
      const latestAttempt = c.latest_attempt_at ? new Date(c.latest_attempt_at).getTime() : 0;
      const lastSent = c.last_sent_at ? new Date(c.last_sent_at).getTime() : 0;
      let step = 0;
      if (sentCount===0) { if (latestAttempt && (now-latestAttempt) >= HOUR) step=1; }
      else if (lastSent && (now-lastSent) >= WEEK) { step = sentCount===1 ? 2 : 3; }
      if (step===0 && !onlyUserId) { skipped++; bump("not_due"); continue; }
      if (step===0 && onlyUserId) step = sentCount===0?1:(sentCount===1?2:3); // force a send for single-user test

      const firstName = firstNameOf(c.display_name);
      const html = buildFor(step, firstName, c.user_id, planLabelOf(c.plan_key), planOfferOf(c.plan_key), Number(c.attempts)||1, castList, castMore);
      outbox.push({ userId:c.user_id, email, step, subject:subjectFor(step,firstName), html });
    }

    const BATCH=100;
    for (let i=0;i<outbox.length;i+=BATCH) {
      const group = outbox.slice(i,i+BATCH);
      const results = await sendBatch(group.map((o)=>({ to:[o.email], subject:o.subject, html:o.html, headers:{ "List-Unsubscribe":`<${UNSUB_BASE}?action=unsubscribe&uid=${o.userId}>`, "List-Unsubscribe-Post":"List-Unsubscribe=One-Click" } })));
      group.forEach((o,idx)=>{ const r=results[idx];
        if (r?.ok) { sent++; if(!isDryTest) logs.push({user_id:o.userId,email:o.email,step:o.step,status:"sent",provider_message_id:r.id}); }
        else { failed++; if(!isDryTest) logs.push({user_id:o.userId,email:o.email,step:o.step,status:"failed",error_message:r?.err}); } });
      if (i+BATCH<outbox.length) await new Promise((r)=>setTimeout(r,600));
    }

    if (!isDryTest) { for (let i=0;i<logs.length;i+=500) { try { await sb.from("winback_logs").insert(logs.slice(i,i+500)); } catch(e){ console.error("[winback] log insert failed",e); } } }

    const summary = { ok:true, sent, skipped, failed, candidates:candidates.length, skip_reasons:skipReasons, test:isDryTest||undefined };
    console.log("[winback-run] complete", JSON.stringify(summary));
    return res(summary);
  } catch (e) {
    console.error("[winback-run]", e);
    return res({error:String(e)},500);
  }
});

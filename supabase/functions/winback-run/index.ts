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

// ── Shared bits — "Daylight" design system ──────────────────────────────────
// One system across all three emails: same header, same full-bleed film still,
// same CTA shape, same studio strip, same footer. Only the accent still changes
// per step. Palette is light + brand teal so the email matches the checkout page
// it sends people back to.
const C = {
  paper:"#F4F7F6", card:"#FFFFFF", ink:"#16202A", body:"#4A5A5C", muted:"#93A0A0",
  line:"#E2EBE9", panel:"#EDF5F3", brand:"#2F7E7F", soft:"#DCEAE7", footBg:"#EDF2F1", footInk:"#8C9A9A",
};
const SERIF = "Georgia,'Times New Roman',serif";

// Film stills — one per step. Deliberately outside the daily-digest and
// premium-upsell rotation so the sequence never repeats a picture the user has
// already seen elsewhere. Each set covers A24 / Neon / Netflix.
const STILLS: Record<number,{url:string;title:string;studio:string}> = {
  1: { url:"https://image.tmdb.org/t/p/w1280/7HR38hMBl23lf38MAN63y4pKsHz.jpg", title:"Past Lives",  studio:"A24" },
  2: { url:"https://image.tmdb.org/t/p/w1280/dKqa850uvbNSCaQCV4Im1XlzEtQ.jpg", title:"Glass Onion", studio:"Netflix" },
  3: { url:"https://image.tmdb.org/t/p/w1280/bKCpRjjTKcr3KAITmwjVMobbBYg.jpg", title:"Minari",      studio:"A24" },
};

function studioStrip(): string {
  const L = (f:string, w:number) => `<img src="${APP_URL}/logos/${f}" height="17" style="height:17px;width:${w}px;vertical-align:middle;border:none;" alt=""/>`;
  const bar = `<span style="color:${C.line};">&#124;</span>`;
  return `<div style="padding:18px 0 6px;text-align:center;">
    <div style="font-size:10.5px;font-weight:700;color:${C.muted};letter-spacing:1.3px;text-transform:uppercase;margin-bottom:9px;">From indie films to</div>
    <div style="line-height:1;">${L("a24-black.png",41)}&nbsp;&nbsp;&nbsp;${bar}&nbsp;&nbsp;&nbsp;${L("neon-black.png",60)}&nbsp;&nbsp;&nbsp;${bar}&nbsp;&nbsp;&nbsp;${L("netflix-red.png",63)}</div>
    <div style="font-size:10.5px;font-weight:700;color:${C.muted};letter-spacing:1.3px;text-transform:uppercase;margin-top:9px;">&mdash; level projects</div>
  </div>`;
}

function header(eyebrow: string): string {
  return `<tr><td style="padding:18px 26px 14px;border-bottom:1px solid ${C.line};">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td style="vertical-align:middle;"><span style="display:inline-block;width:34px;height:34px;border-radius:9px;background:${C.ink};text-align:center;line-height:31px;vertical-align:middle;"><img src="${LOGO_URL}" width="26" height="26" alt="CastSlate" style="vertical-align:middle;border:none;"/></span>&nbsp;&nbsp;<span style="font-size:17px;font-weight:800;color:${C.ink};letter-spacing:-0.3px;vertical-align:middle;">CastSlate</span></td>
      <td style="text-align:right;vertical-align:middle;"><span style="font-size:9.5px;font-weight:800;color:${C.brand};letter-spacing:1.5px;text-transform:uppercase;background:${C.panel};padding:5px 11px;border-radius:20px;">${esc(eyebrow)}</span></td>
    </tr></table></td></tr>`;
}

function hero(step: number): string {
  const s = STILLS[step];
  return `<tr><td style="padding:0;line-height:0;"><img src="${s.url}" width="600" alt="Still from ${esc(s.title)}" style="display:block;width:100%;max-width:600px;height:auto;border:none;"/></td></tr>
  <tr><td style="padding:7px 26px 0;text-align:right;"><span style="font-size:10px;color:${C.muted};letter-spacing:0.3px;">Still: ${esc(s.title)} &middot; ${esc(s.studio)}</span></td></tr>`;
}

function ctaRow(label: string, sub: string): string {
  return `<tr><td style="padding:20px 34px 4px;text-align:center;">
    <a href="${CTA_URL}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:15px 42px;border-radius:10px;font-size:15px;font-weight:800;letter-spacing:0.1px;">${label}</a>
    <div style="margin-top:11px;font-size:12px;color:${C.muted};">${sub}</div></td></tr>`;
}

function directoryNote(): string {
  return `<tr><td style="padding:18px 30px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.panel};border-radius:12px;"><tr>
      <td style="padding:15px 18px;">
        <div style="font-size:9.5px;font-weight:800;color:${C.brand};letter-spacing:1.4px;text-transform:uppercase;margin-bottom:6px;">Also included</div>
        <div style="font-size:13.5px;line-height:1.6;color:${C.body};">The <b style="color:${C.ink};">550+ Talent Agency &amp; Management Directory</b> &mdash; LA and NY agencies with submission details, yours the moment you're in.</div>
      </td></tr></table></td></tr>`;
}

function footerRow(uid: string, note: string): string {
  return `<tr><td style="background:${C.footBg};padding:18px 30px;text-align:center;">
    <div style="font-size:11.5px;color:${C.footInk};line-height:1.65;">${note}<br/>CastSlate &middot; Your career, one link. &nbsp;${footerUnsub(uid)}</div></td></tr>`;
}

function footerUnsub(uid: string): string {
  return `<a href="${UNSUB_BASE}?action=unsubscribe&uid=${encodeURIComponent(uid)}" style="color:${C.footInk};text-decoration:underline;">Unsubscribe</a>`;
}

function docShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.paper};padding:26px 12px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">
${inner}
</table></td></tr></table></body></html>`;
}

// ── ① One step away ──
function email1(firstName: string, uid: string, planLabel: string, planOffer: string): string {
  const inner = header("Almost there") + hero(1) + `
  <tr><td style="padding:22px 34px 4px;text-align:center;">
    <h1 style="margin:0 0 12px;font-family:${SERIF};font-size:30px;font-weight:700;color:${C.ink};letter-spacing:-0.5px;line-height:1.22;">You were one step<br/>from Premium, ${esc(firstName)}.</h1>
    <p style="margin:0 auto;font-size:15.5px;line-height:1.7;color:${C.body};max-width:420px;">Your ${esc(planLabel)} is still sitting in checkout. It takes about 20 seconds to finish &mdash; your details are already there.</p></td></tr>
  <tr><td style="padding:22px 34px 0;">
    <div style="font-size:10px;font-weight:800;color:${C.brand};letter-spacing:1.3px;text-transform:uppercase;margin-bottom:9px;">Your signup &middot; 90% complete</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.soft};border-radius:20px;overflow:hidden;"><tr><td style="height:9px;width:90%;background:${C.brand};border-radius:20px;"></td><td style="width:10%;"></td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:12px;"><tr>
      <td style="font-size:12.5px;color:${C.brand};font-weight:700;">&#10003; Account created</td>
      <td style="font-size:12.5px;color:${C.brand};font-weight:700;text-align:center;">&#10003; Plan chosen</td>
      <td style="font-size:12.5px;color:${C.muted};font-weight:700;text-align:right;">&#9675; Confirm payment</td>
    </tr></table></td></tr>`
  + ctaRow("Finish &amp; unlock Premium &rarr;", `${esc(planOffer)} &middot; Nothing charged until you confirm`)
  + directoryNote() + `
  <tr><td style="padding:4px 30px 0;">${studioStrip()}</td></tr>
  <tr><td style="padding:14px 30px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid ${C.line};"><tr><td style="padding-top:14px;">
      <div style="font-size:13.5px;color:${C.body};line-height:1.6;text-align:center;">Free members get <b style="color:${C.ink};">one</b> submission a week. Premium members applied to <b style="color:${C.ink};">every</b> casting the moment it posted.</div>
    </td></tr></table></td></tr>
  <tr><td style="height:20px;"></td></tr>`
  + footerRow(uid, "You started a Premium signup on CastSlate.");
  return docShell(`You were one step from Premium, ${firstName}`, inner);
}

// ── ② Locked out ──
function email2(firstName: string, uid: string, attempts: number, castings: {title:string;meta:string}[], moreCount: number): string {
  const rows = castings.map((c)=>`<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.panel};border-radius:12px;margin-bottom:9px;"><tr>
      <td style="padding:14px 16px;"><div style="font-size:14.5px;font-weight:800;color:${C.muted};letter-spacing:0.2px;">${esc(c.title)} &nbsp;&bull;&bull;&bull;&bull;</div>
      <div style="font-size:12px;color:${C.muted};margin-top:3px;">${esc(c.meta)}</div></td>
      <td style="text-align:right;padding-right:16px;width:34px;"><span style="font-size:17px;">&#128274;</span></td></tr></table>`).join("");
  const more = moreCount>0 ? `<div style="text-align:center;padding:4px 0 0;"><span style="font-size:12.5px;color:${C.muted};font-weight:600;">+ ${moreCount} more role${moreCount!==1?"s":""} you couldn't submit to this week</span></div>` : "";
  const intro = attempts>=3
    ? `You've opened checkout <b style="color:${C.ink};">${attempts} times</b>. Meanwhile these roles went live this week &mdash; and Premium members were first in line for every one.`
    : `You started signing up for Premium but didn't finish. Meanwhile these roles went live this week &mdash; and Premium members were first in line for every one.`;
  const head = attempts>=3 ? `You keep coming back,<br/>${esc(firstName)}. So does the work.` : `${esc(firstName)}, the work<br/>didn't wait for you.`;
  const inner = header("Premium locked") + hero(2) + `
  <tr><td style="padding:22px 34px 4px;text-align:center;">
    <h1 style="margin:0 0 12px;font-family:${SERIF};font-size:29px;font-weight:700;color:${C.ink};letter-spacing:-0.5px;line-height:1.22;">${head}</h1>
    <p style="margin:0 auto;font-size:15.5px;line-height:1.7;color:${C.body};max-width:430px;">${intro}</p></td></tr>
  <tr><td style="padding:20px 30px 0;">${rows}${more}</td></tr>`
  + ctaRow("Unlock every casting &rarr;", "$14.95/month or $99/year &middot; unlimited submissions")
  + directoryNote() + `
  <tr><td style="padding:4px 30px 0;">${studioStrip()}</td></tr>
  <tr><td style="height:22px;"></td></tr>`
  + footerRow(uid, "You reached Premium checkout on CastSlate.");
  return docShell(`${firstName}, these castings went live without you`, inner);
}

// ── ③ Founder note ──
function email3(firstName: string, uid: string): string {
  const inner = header("A note from us") + hero(3) + `
  <tr><td style="padding:24px 38px 4px;">
    <h1 style="margin:0 0 16px;font-family:${SERIF};font-size:25px;font-weight:700;color:${C.ink};letter-spacing:-0.3px;line-height:1.3;">A quick note, ${esc(firstName)} &mdash;</h1>
    <p style="margin:0 0 14px;font-size:15.5px;line-height:1.72;color:${C.body};">We noticed you started signing up for Premium but didn't finish. No pressure at all &mdash; we just wanted to make sure nothing broke on our end.</p>
    <p style="margin:0 0 14px;font-size:15.5px;line-height:1.72;color:${C.body};">Here's the honest pitch: free accounts get one submission a week. That's fine to test the waters, but the actors booking work are the ones applying the day a role drops. Premium unlocks unlimited submissions, every casting the moment it posts, our 550+ talent agency &amp; management directory, and your shareable TapeLink card.</p>
    <p style="margin:0 0 4px;font-size:15.5px;line-height:1.72;color:${C.body};">Whenever you're ready, it's right here. Takes about 20 seconds and you're in.</p></td></tr>
  <tr><td style="padding:18px 34px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.panel};border-radius:12px;"><tr>
      <td style="padding:16px 20px;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
        <td><div style="font-size:11.5px;color:${C.muted};">CastSlate Premium</div>
        <div style="font-size:23px;font-weight:800;color:${C.ink};letter-spacing:-0.5px;">$99 <span style="font-size:12.5px;font-weight:600;color:${C.muted};">/ year &middot; or $14.95 monthly</span></div></td>
        <td style="text-align:right;"><span style="display:inline-block;background:${C.card};color:${C.brand};font-size:10.5px;font-weight:800;padding:5px 11px;border-radius:20px;">Unlimited submissions</span></td>
      </tr></table></td></tr></table></td></tr>`
  + ctaRow("Finish signing up &rarr;", "Cancel anytime") + `
  <tr><td style="padding:4px 30px 0;">${studioStrip()}</td></tr>
  <tr><td style="padding:14px 38px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid ${C.line};"><tr><td style="padding-top:15px;">
      <div style="font-size:14.5px;line-height:1.6;color:${C.body};">Either way, glad you're here.<br/><span style="font-family:${SERIF};font-style:italic;font-size:16px;color:${C.ink};">&mdash; The CastSlate Team</span></div>
    </td></tr></table></td></tr>
  <tr><td style="height:20px;"></td></tr>`
  + footerRow(uid, "You're getting this because you started a Premium signup.");
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
  return "$14.95/month · cancel anytime";
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
        { to:[to_email], subject:subjectFor(1,"there"), html:email1("there","test-uid","monthly plan","$14.95/month · cancel anytime") },
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

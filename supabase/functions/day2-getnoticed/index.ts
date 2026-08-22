// day2-getnoticed — Supabase Edge Function
// The automated Day-2 "Get Noticed Faster" welcome email for new actors.
//
// Fires ~24h after registration, ONCE per actor, to confirmed / non-premium /
// under-90%-complete talent. The eligibility rule lives in the SQL function
// public.day2_eligible_actors() so it is the single source of truth.
//
// POST { action:"dry_run", secret }        -> count who would receive it now (no send)
// POST { action:"test", to_email, secret }  -> preview send to one address
// POST { action:"run",  secret }            -> send to every eligible actor, mark them sent
// GET  ?action=unsubscribe&uid=<id>         -> opt out of THIS email only
//
// DESIGN (2026-08-22): rebuilt on the decision-email shell the shortlist, hold
// and daily-recap emails share — logo tile masthead over a gradient band, 4px
// tone stripe, two-line Georgia headline with a hexagon badge beside it, tinted
// cards, dark footer band with a tinted bell. Tone is "Teal Signal", the colour
// this email already spoke in. The three teaching sections (quality-beats-
// quantity, tips A–D, the weekly quote) carried over as cards in that tone.
// Assets live at the repo root, served from APP_URL: logo-email-tile.png,
// email-progress-badge.png, email-bell-teal.png.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "cmpn_9e872b254fab6297129ac7ee95c021831a2163dd1f7a9906";
const UNSUB_BASE           = `${SUPABASE_URL}/functions/v1/day2-getnoticed`;

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, GET, OPTIONS",
};

interface SendArgs { from:string; to:string[]; subject:string; html:string; replyTo?:string; headers?:Record<string,string>; }
interface SendResult { ok:boolean; id:string|null; err:string|null; status:number; }

async function sendEmail(a: SendArgs): Promise<SendResult> {
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

async function sendBatch(items: SendArgs[]): Promise<SendResult[]> {
  if (!RESEND_API_KEY) return items.map(()=>({ ok:false, id:null, err:"RESEND_API_KEY not set", status:500 }));
  // deno-lint-ignore no-explicit-any
  const payload = items.map((a) => { const o:any = { from:a.from, to:a.to, subject:a.subject, html:a.html }; if(a.replyTo) o.reply_to=a.replyTo; if(a.headers) o.headers=a.headers; return o; });
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(payload),
    });
    if (r.ok) {
      const d = await r.json().catch(()=>({}));
      // deno-lint-ignore no-explicit-any
      const arr:any[] = Array.isArray((d as any)?.data) ? (d as any).data : [];
      return items.map((_, i) => ({ ok:true, id: arr[i]?.id ?? null, err:null, status:r.status }));
    }
    const errText = await r.text();
    return items.map(() => ({ ok:false, id:null, err:errText, status:r.status }));
  } catch (e) { return items.map(() => ({ ok:false, id:null, err:String(e), status:500 })); }
}

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

// deno-lint-ignore no-explicit-any
function assess(p: any) {
  const core = [
    { label:"Upload a headshot",           done: has(p.headshot_url) },
    { label:"Add your height &amp; weight", done: has(p.height) && has(p.weight) },
    { label:"Add your special skills",      done: Array.isArray(p.skills) && p.skills.filter(Boolean).length>0 },
    { label:"Write a short bio",            done: has(p.bio) },
    { label:"Add your acting experience",   done: has(p.credits) },
  ];
  const bonus = [
    { label:"Add a demo reel",   done: has(p.reel_url) || has(p.slate_video_url) },
    { label:"Upload your r&eacute;sum&eacute;", done: has(p.resume_url) },
  ];
  const doneCount = core.filter(c=>c.done).length;
  const pct = Math.round(doneCount/core.length*100);
  return { core, bonus, pct };
}

// Weekly-rotating audition tip (ISO-week index into the pool).
const WEEKLY_TIPS = [
  "Submit early. Casting directors often start reading the moment a role goes live &mdash; the first strong tapes set the bar.",
  "Book the room, not the role. Casting directors remember actors who are easy to work with long after they've forgotten the lines.",
  "Slate like a person, not a r&eacute;sum&eacute;. A warm, present hello tells them more than a list of credits.",
  "Frame yourself from the chest up in even, soft light. They cast the face they can actually see.",
  "Make a strong, specific choice and commit to it. A clear choice beats a safe, vague one every time.",
  "Read the whole breakdown before you tape. Half your competition didn't &mdash; and it shows.",
];
function weeklyTip(): { text:string; n:number } {
  const now = new Date();
  const oneJan = new Date(now.getFullYear(),0,1);
  const week = Math.ceil((((now.getTime()-oneJan.getTime())/86400000)+oneJan.getDay()+1)/7);
  return { text: WEEKLY_TIPS[week % WEEKLY_TIPS.length], n: week };
}

// ── Teal Signal tone ────────────────────────────────────────────────────────
// Same shape as the DecisionTone objects in send-notification-email. Kept flat
// because this function only ever wears one tone — if a second is ever added,
// lift it to that shared shape first rather than forking the colours.
const T = {
  band:   "#0E5E5A", band2: "#17817A", foot: "#0A3E3B",
  onDark: "#7FD8CF", onCream: "#0F5F5A",
  rule:   "#29A79C", rule0: "rgba(14,94,90,0)",
  kicker: "#0F6B65", card: "#E8F5F3", cardBd: "#CBE7E2", cta: "#0F5F5A",
};

// Round 26px icon chip — the checklist equivalent of the recap email's stat chips.
function chip(bg: string, color: string, glyph: string, border?: string): string {
  const bd = border ? `;border:1.5px solid ${border}` : "";
  return `<td style="width:38px;vertical-align:top;padding-right:12px">
              <table cellpadding="0" cellspacing="0"><tr><td width="26" height="26" align="center" style="width:26px;height:26px;background:${bg};border-radius:13px${bd};text-align:center;vertical-align:middle;font-size:13px;line-height:26px;color:${color};font-weight:700">${glyph}</td></tr></table>
            </td>`;
}
const todoRow  = (label: string) => `<tr>${chip("#FFFFFF", T.kicker, "&#9675;", T.cardBd)}<td style="vertical-align:middle;padding:5px 0;font-size:15px;line-height:1.45;color:#1A1A2E;font-weight:600">${label}</td></tr>`;
const doneRow  = (label: string) => `<tr>${chip(T.band2, "#FFFFFF", "&#10003;")}<td style="vertical-align:middle;padding:5px 0;font-size:14.5px;line-height:1.45;color:#8C8C9E;text-decoration:line-through">${label}</td></tr>`;
const bonusRow = (label: string) => `<tr>${chip("#FFFFFF", T.kicker, "&#9734;", T.cardBd)}<td style="vertical-align:middle;padding:5px 0;font-size:14.5px;line-height:1.45;color:#5A5A72">${label} <span style="font-size:11.5px;font-style:italic;color:#9A9AAE">optional</span></td></tr>`;
const listLabel = (t: string, muted = false) =>
  `<div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${muted ? "#9A9AAE" : T.kicker};margin:16px 0 10px">${t}</div>`;

interface Assessed { core:{label:string;done:boolean}[]; bonus:{label:string;done:boolean}[]; pct:number; }
function buildEmail(first: string, a: Assessed, userId: string): string {
  const { core, bonus, pct } = a;
  const missing      = core.filter(c=>!c.done);
  const done         = core.filter(c=>c.done);
  const bonusMissing = bonus.filter(b=>!b.done);
  const tip     = weeklyTip();
  const unsub   = `${UNSUB_BASE}?action=unsubscribe&uid=${userId}`;
  const fillPct = Math.max(4, pct);

  const headTop    = pct === 0 ? "You&rsquo;re moments away" : `You&rsquo;re ${pct}% of the way`;
  const headAccent = pct === 0 ? "from getting noticed" : "to getting noticed";
  const remaining  = missing.length === 1 ? "one more detail" : `${missing.length} more details`;

  const missingBlock = missing.length
    ? `${listLabel("Still to add")}<table width="100%" cellpadding="0" cellspacing="0">${missing.map(c=>todoRow(c.label)).join("")}</table>` : "";
  const doneBlock = done.length
    ? `${listLabel("Already done", true)}<table width="100%" cellpadding="0" cellspacing="0">${done.map(c=>doneRow(c.label)).join("")}</table>` : "";
  const bonusBlock = bonusMissing.length
    ? `${listLabel("Bonus &mdash; stand out even more")}<table width="100%" cellpadding="0" cellspacing="0">${bonusMissing.map(c=>bonusRow(c.label)).join("")}</table>` : "";

  const askRow = (n: string, q: string) =>
    `<tr><td width="26" valign="top" style="font-family:Georgia,'Times New Roman',serif;font-weight:700;color:${T.onCream};font-size:14px;padding:5px 0">${n}</td><td style="font-size:14px;line-height:1.45;color:#45506A;padding:5px 0">${q}</td></tr>`;
  const tipRow = (k: string, bodyTxt: string) =>
    `<tr><td width="38" valign="top" style="padding:7px 12px 7px 0"><table cellpadding="0" cellspacing="0"><tr><td width="26" height="26" align="center" style="width:26px;height:26px;background:${T.card};border:1px solid ${T.cardBd};border-radius:13px;text-align:center;vertical-align:middle;font-family:Georgia,'Times New Roman',serif;font-size:12.5px;font-weight:700;color:${T.onCream};line-height:26px">${k}</td></tr></table></td><td style="padding:7px 0;font-size:13.5px;line-height:1.55;color:#45506A">${bodyTxt}</td></tr>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${pct===0?"Let's get you noticed":`You're ${pct}% of the way to getting noticed`} &mdash; CastSlate</title>
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

      <tr><td class="cs-pad" style="background:${T.band};background:linear-gradient(115deg,${T.band2} 0%,${T.band} 62%,${T.band2} 100%);padding:22px 30px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle"><table cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:14px"><img class="cs-mark" src="${APP_URL}/logo-email-tile.png" width="46" height="46" alt="CastSlate" style="display:block;border-radius:11px"/></td>
            <td style="vertical-align:middle"><span class="cs-word" style="font-size:24px;font-weight:800;letter-spacing:1.7px;color:#FFFFFF;white-space:nowrap">CASTSLATE</span></td>
          </tr></table></td>
          <td class="cs-kicker" align="right" style="vertical-align:middle;padding-left:18px"><span style="font-size:10px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:${T.onDark}">Profile progress</span></td>
        </tr></table>
      </td></tr>

      <tr><td style="height:4px;line-height:4px;font-size:0;background:${T.rule};background:linear-gradient(90deg,${T.onDark},${T.rule} 52%,${T.rule0})">&nbsp;</td></tr>

      <tr><td class="cs-pad" style="padding:34px 30px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top">
            <h1 class="cs-h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:31px;font-weight:700;color:#1A1A2E;letter-spacing:-0.5px;line-height:1.22">${headTop}<br/><span style="color:${T.onCream}">${headAccent}</span></h1>
          </td>
          <td class="cs-badge-cell" align="right" style="vertical-align:top;width:112px">
            <img class="cs-badge" src="${APP_URL}/email-progress-badge.png" width="104" height="80" alt="" style="display:block;border:0"/>
          </td>
        </tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="padding:20px 30px 0"><p style="margin:0;font-size:15px;line-height:1.78;color:#5A5A72">Casting directors see finished profiles first, ${first}. You're most of the way there &mdash; ${remaining} and you're in the running.</p></td></tr>

      <tr><td class="cs-pad" style="padding:22px 30px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${T.card};border:1px solid ${T.cardBd};border-radius:12px;padding:18px 20px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle"><div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${T.kicker}">Profile completion</div></td>
              <td align="right" style="vertical-align:middle"><span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:${T.onCream};line-height:1">${pct}%</span></td>
            </tr></table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:#FFFFFF;border:1px solid ${T.cardBd};border-radius:999px"><tr>
              <td width="${fillPct}%" style="height:10px;background:${T.band2};border-radius:999px;font-size:0;line-height:0">&nbsp;</td>
              <td style="font-size:0;line-height:0">&nbsp;</td>
            </tr></table>
          </td></tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="padding:14px 30px 0">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${T.card};border:1px solid ${T.cardBd};border-radius:12px;padding:6px 20px 16px">
            ${missingBlock}
            ${doneBlock}
            ${bonusBlock}
          </td></tr></table>
      </td></tr>

      <tr><td class="cs-pad cs-cta" style="padding:24px 30px 30px">
        <table cellpadding="0" cellspacing="0"><tr><td style="background:${T.cta};border-radius:11px">
          <a href="${APP_URL}/my-profile" style="display:inline-block;padding:16px 34px;font-size:14.5px;font-weight:800;letter-spacing:0.2px;color:#FFFFFF;text-decoration:none">Finish my profile &nbsp;&rarr;</a>
        </td></tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="padding:26px 30px 0;border-top:1px solid #EFE7D6">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${T.kicker};margin:0 0 8px">Submit smarter</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:21px;color:#1A1A2E;margin:0 0 6px">Quality beats quantity</div>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#5A5A72">Submitting to every casting you see doesn't raise your odds &mdash; it reads as desperate and buries your best work. A few focused, honest submissions go further than a hundred scattered ones.</p>
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${T.card};border:1px solid ${T.cardBd};border-radius:12px;padding:18px 20px">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:15.5px;color:#1A1A2E;margin:0 0 10px">Before you submit for any role, ask yourself:</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${askRow("1.","Can I <b>really</b> play this character?")}
              ${askRow("2.","Do I genuinely <b>connect</b> with who they are?")}
              ${askRow("3.","Can I put myself in this character's <b>shoes</b>?")}
            </table>
            <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#45506A">If it's yes, submit with conviction. If it's no, let it pass &mdash; the right role is coming.</p>
          </td></tr></table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">
          ${tipRow("A","<b style='color:#1A1A2E'>Read the whole breakdown first.</b> The role, the tone, the story &mdash; submitting blind wastes your slot and the casting director's time.")}
          ${tipRow("B","<b style='color:#1A1A2E'>Know your lane.</b> Match yourself honestly on age and type. Stretching too far reads as not knowing your own strengths.")}
          ${tipRow("C","<b style='color:#1A1A2E'>Submit early, not frantically.</b> Casting directors often start reading the moment a role goes live &mdash; but only when you're genuinely right for it.")}
          ${tipRow("D","<b style='color:#1A1A2E'>Add a short, specific note</b> when it fits &mdash; one line on why <i>this</i> role, not a generic pitch you paste everywhere.")}
        </table>
      </td></tr>

      <tr><td class="cs-pad" style="padding:26px 30px 30px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${T.kicker};margin:0 0 10px">This week's tip</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${T.band};border-radius:12px"><tr><td style="padding:22px 24px">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:0;color:${T.onDark};height:16px">&ldquo;</div>
          <p style="margin:8px 0 12px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:16px;line-height:1.55;color:#F2FBF9">${tip.text}</p>
          <div style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${T.onDark}">Rotates weekly &middot; Tip #${tip.n}</div>
        </td></tr></table>
      </td></tr>

      <tr><td class="cs-pad" style="background:${T.foot};padding:22px 30px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;width:38px;padding-top:2px"><img src="${APP_URL}/email-bell-teal.png" width="26" height="26" alt="" style="display:block;border:0"/></td>
          <td style="vertical-align:top"><p style="margin:0;font-size:12px;line-height:1.75;color:rgba(255,255,255,0.70)">You're receiving this because you created a CastSlate account.<br/>Need help? <a href="mailto:${CONTACT_EMAIL}" style="color:${T.onDark};text-decoration:none;font-weight:700">${CONTACT_EMAIL}</a><br/>Manage notifications in <a href="${APP_URL}/account-settings" style="color:${T.onDark};text-decoration:none;font-weight:700">Account Settings</a> &middot; <a href="${unsub}" style="color:${T.onDark};text-decoration:none;font-weight:700">Unsubscribe</a>.</p></td>
        </tr></table>
      </td></tr>

    </table>
  <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
}

function subjectFor(pct: number, first: string): string {
  return pct === 0
    ? `Let's get you noticed on CastSlate, ${first}`
    : `You're ${pct}% of the way to getting noticed, ${first}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action")==="unsubscribe" && url.searchParams.get("uid")) {
      const uid = url.searchParams.get("uid")!;
      await sb.from("email_preferences").upsert({ user_id:uid, day2_optout:true, updated_at:new Date().toISOString() }, { onConflict:"user_id" });
      try { await sb.from("day2_email_logs").insert({ user_id:uid, status:"skipped", reason:"unsubscribe_click" }); } catch(_){ /* non-fatal */ }
      return new Response(null,{ status:302, headers:{ "Location":`${APP_URL}/unsubscribed` } });
    }
    return new Response("Not found",{status:404});
  }

  const res = (b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});

  try {
    const body = await req.json().catch(()=>({}));
    const { action, to_email, secret } = body;

    let authorized = !!secret && (secret===SUPABASE_SERVICE_KEY || (ADMIN_SECRET && secret===ADMIN_SECRET));
    if (!authorized) {
      const authz = req.headers.get("Authorization")||"";
      if (authz.startsWith("Bearer ")) {
        try { const { data:{ user } } = await sb.auth.getUser(authz.slice(7));
          if (user) { const { data:prof } = await sb.from("profiles").select("user_type").eq("id",user.id).maybeSingle();
            if (prof && ["admin","super_admin"].includes(prof.user_type)) authorized=true; } } catch(_){ /* fall through */ }
      }
    }
    if (!authorized) return res({error:"Unauthorized"},401);
    if (!RESEND_API_KEY) return res({error:"Email provider not configured"},500);

    // deno-lint-ignore no-explicit-any
    const { data: eligible, error } = await sb.rpc("day2_eligible_actors",{ p_limit: action==="dry_run"?5000:2000 }) as any;
    if (error) return res({error:String(error.message||error)},500);
    const rows = eligible || [];

    if (action === "dry_run") return res({ ok:true, eligible_now: rows.length });

    if (action === "test") {
      if (!to_email) return res({error:"to_email required"},400);
      const sample = assess({ headshot_url:"x", height:"5'10\"", weight:"160", skills:[], bio:"", credits:"Some credits", reel_url:null, slate_video_url:null, resume_url:null });
      const html = buildEmail("there", sample, "test");
      const r = await sendEmail({ from:FROM_EMAIL, to:[to_email], replyTo:CONTACT_EMAIL, subject:subjectFor(sample.pct,"there"), html });
      if (!r.ok) return res({error:r.err},500);
      return res({ ok:true, test:true, to:to_email, provider_id:r.id });
    }

    if (action !== "run") return res({error:"Unknown action"},400);

    interface Out { userId:string; email:string; subject:string; html:string; }
    const outbox: Out[] = [];
    // deno-lint-ignore no-explicit-any
    for (const p of rows as any[]) {
      const a = assess(p);
      outbox.push({ userId:p.id, email:p.email, subject:subjectFor(a.pct, p.first_name||"there"), html:buildEmail(p.first_name||"there", a, p.id) });
    }

    const logs: Record<string,unknown>[] = [];
    const sentIds: string[] = [];
    let sent=0, failed=0;
    const BATCH=100;
    for (let i=0;i<outbox.length;i+=BATCH) {
      const group = outbox.slice(i,i+BATCH);
      const results = await sendBatch(group.map((o)=>({ from:FROM_EMAIL, to:[o.email], replyTo:CONTACT_EMAIL, subject:o.subject, html:o.html,
        headers:{ "List-Unsubscribe":`<${UNSUB_BASE}?action=unsubscribe&uid=${o.userId}>`, "List-Unsubscribe-Post":"List-Unsubscribe=One-Click" } })));
      group.forEach((o,idx)=>{
        const r = results[idx];
        if (r?.ok) { sent++; sentIds.push(o.userId); logs.push({ user_id:o.userId, email:o.email, status:"sent", provider_message_id:r.id }); }
        else { failed++; logs.push({ user_id:o.userId, email:o.email, status:"failed", error_message:r?.err }); }
      });
      if (i+BATCH<outbox.length) await new Promise((r)=>setTimeout(r,600));
    }

    for (let i=0;i<sentIds.length;i+=500) {
      try { await sb.from("profiles").update({ day2_email_sent_at:new Date().toISOString() }).in("id", sentIds.slice(i,i+500)); } catch(e){ console.error("[day2] mark sent failed",e); }
    }
    for (let i=0;i<logs.length;i+=500) {
      try { await sb.from("day2_email_logs").insert(logs.slice(i,i+500)); } catch(e){ console.error("[day2] log insert failed",e); }
    }

    const summary = { ok:true, sent, failed, total_eligible:rows.length };
    console.log("[day2-getnoticed] run complete", JSON.stringify(summary));
    return res(summary);
  } catch(e) {
    console.error("[day2-getnoticed]", e);
    return res({error:String(e)},500);
  }
});

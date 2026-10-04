// agd-intro — Supabase Edge Function
// The automated "Agency Directory" introduction email for NEW actors.
//
// Goes out ONCE per actor, about 3 hours after they sign up (never overnight: sends
// only 8 AM-10 PM Eastern, otherwise it waits for 8 AM). Copy and
// look are the owner-approved "A · Golden Hour" demo (2026-10-02): a film still,
// coral/gold/pink glow around the card, Malcolm Vey + Naya Bellamy sample cards.
//
// POST { action:"dry_run" }                  -> who would be mailed right now (no send)
// POST { action:"test", to_email, first_name? } -> preview send to one address, never logged
// POST { action:"run", force_hour? }          -> the cron call (every 15 min). Sends only between
//                                               8 AM and 10 PM in New York (DST-safe) unless force_hour:true.
// GET  ?action=unsubscribe&uid=<id>           -> opt out of announcements (announce_optout)
//
// WHO: public.agd_intro_eligible() is the single source of truth — confirmed email,
// talent/actor, active account, FREE (premium is never pitched their own perk),
// 3h+ old but under 14 days old (so it never reaches back at old accounts), notifications
// on, not suppressed/unsubscribed/announce_optout, and NOT already in
// member_announce_logs under the same announce key as the first Agency Directory
// mailing — so nobody who got that one is mailed again.
//
// ONCE-ONLY: a successful send writes member_announce_logs (UNIQUE announce_key,user_id).
// Never stamp the guard before Resend accepts the batch.
//
// Auth: service-role key OR ADMIN_CAMPAIGN_SECRET as the Bearer token (verify_jwt is
// FALSE because the unsubscribe link is a plain browser GET).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");

// ── Universal email footer "A · Cream Colophon" (approved 2026-09-10) ─────────
// The SAME helpers live in every CastSlate email function. Change one, change all.
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

const FROM_EMAIL     = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_SECRET   = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "";

// Same key as the first Agency Directory announcement, on purpose: anyone who got
// that is skipped, and the admin Headshot Catalog button sees this send as "already sent".
const ANNOUNCE_KEY = "agency_directory_v1";
const VARIANT      = "intro_3h";
const WINDOW_START_NY = 8;            // earliest send hour, America/New_York
const WINDOW_END_NY   = 22;           // no sends at or after 10 PM
const MAX_PER_RUN  = 200;
const UNSUB_BASE   = `${SUPABASE_URL}/functions/v1/agd-intro`;

const SUBJECT   = "The next face they're looking for could be yours";
const PREHEADER = "Agents and managers in LA and New York are hunting fresh faces for films and TV. Unlock the Agency Directory.";

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, GET, OPTIONS",
};
const res = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status:s, headers:{ ...cors, "Content-Type":"application/json" } });
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c] as string));

// ── "A · Golden Hour" (La La Land still, coral / gold / pink / violet glow) ──
const A = {
  still:"https://image.tmdb.org/t/p/w1280/2wmDyHz4gvF6m51IQZJnJzlLsnz.jpg",
  page:"#F6E6DC",
  bg:"radial-gradient(ellipse 700px 520px at 6% 0%,rgba(255,126,84,.95) 0%,rgba(255,126,84,0) 70%),radial-gradient(ellipse 700px 520px at 100% 4%,rgba(255,196,94,.95) 0%,rgba(255,196,94,0) 68%),radial-gradient(ellipse 760px 640px at 100% 100%,rgba(226,82,160,.8) 0%,rgba(226,82,160,0) 70%),radial-gradient(ellipse 760px 640px at 0% 100%,rgba(122,92,224,.75) 0%,rgba(122,92,224,0) 70%)",
  mast:"#2A1538", mastMute:"rgba(255,255,255,.55)",
  bar:"linear-gradient(90deg,#FF7E54,#E2529F)", barSolid:"#E8553D",
  ink:"#2B1636", body:"#5B4660", accent:"#D6452F", line:"#F3D9CB",
  btn:"linear-gradient(90deg,#F2643A,#DB3F86)", shadow:"rgba(120,40,90,.28)",
};

// hasHeadshot=false only changes step 2: "Add your photo" instead of "your card has your photo".
// (Owner, 2026-10-03: everyone new gets it; 83% have a photo, and gating on one would
// mail people at odd times or never.)
function introHtml(first: string, unsubUrl: string, hasHeadshot = true): string {
  const T = A;
  const step = (n: number, t: string, b: string) =>
    `<tr><td valign="top" style="width:46px;padding:0 0 18px"><table cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" valign="middle" style="width:34px;height:34px;border-radius:17px;background:${T.barSolid};background:${T.bar};font-size:15px;font-weight:800;color:#fff;line-height:34px">${n}</td></tr></table></td>
    <td valign="top" style="padding:1px 0 18px"><div style="font-size:16px;font-weight:800;color:${T.ink};line-height:1.3">${t}</div><div style="font-size:14.5px;line-height:1.55;color:${T.body};margin-top:3px">${b}</div></td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
@media only screen and (max-width:600px){
 .o{padding:14px 10px !important}
 .p{padding-left:22px !important;padding-right:22px !important}
 .h{font-size:28px !important;line-height:1.14 !important}
 .m{padding:20px 20px !important}
}
</style></head>
<body style="margin:0;padding:0;background:${T.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${PREHEADER}</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="o" bgcolor="${T.page}" style="background:${T.page};background-image:${T.bg};padding:40px 22px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:600px;background:#FFFCF7;border-radius:18px;overflow:hidden;box-shadow:0 14px 50px ${T.shadow}">

 <tr><td class="m" style="background:${T.mast};padding:22px 32px">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
   <td valign="middle" style="width:48px"><img src="${APP_URL}/logo-email-tile-white.png" width="38" height="38" alt="CastSlate" style="display:block;border:0;border-radius:9px"/></td>
   <td valign="middle"><div style="font-size:21px;font-weight:800;letter-spacing:-.4px;color:#fff;line-height:1.1">CastSlate</div></td>
   <td valign="middle" align="right"><span style="font-size:10.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${T.mastMute}">Agency Directory</span></td>
  </tr></table>
 </td></tr>

 <tr><td style="padding:0;line-height:0;font-size:0;background:#000"><img src="${T.still}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"/></td></tr>
 <tr><td align="center" style="background:${T.barSolid};background:${T.bar};padding:11px 16px"><span style="font-size:11px;font-weight:800;letter-spacing:2.6px;text-transform:uppercase;color:#fff">Hollywood &middot; New York &middot; Right now</span></td></tr>

 <tr><td class="p" style="padding:36px 40px 6px">
  <h1 class="h" style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;color:${T.ink};letter-spacing:-.6px;line-height:1.14">Hollywood is casting. Be the face they find.</h1>
  <p style="margin:0 0 14px;font-size:16.5px;line-height:1.65;color:${T.body}">Hi ${esc(first)}, agents and managers in Hollywood and New York are always looking for fresh faces to put in films and TV shows. <b style="color:${T.ink}">You never know &mdash; you could be the next face they're looking for.</b></p>
  <p style="margin:0 0 26px;font-size:16.5px;line-height:1.65;color:${T.body}">Unlock the Agency Directory and put your card in their hands.</p>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
   ${step(1,"Unlock the Agency Directory","663 agencies and managers in LA and New York, with the address, website and how each one takes submissions. Plus the Casting Companies Directory: 131 active casting offices, and which ones accept headshots.")}
   ${hasHeadshot
     ? step(2,"Mail them your card","Your CastSlate actor card has your photo and a QR code. Send it from anywhere in the U.S.")
     : step(2,"Add your photo, then mail your card","Upload a headshot and your CastSlate actor card is ready, with your photo and a QR code. Send it from anywhere in the U.S.")}
   ${step(3,"One scan, your whole profile","They scan the code and see your photos, reel and resume.")}
  </table>
 </td></tr>

 <tr><td class="p" style="padding:0 40px 0" align="center">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="background:#FFF1EA;border:1px solid ${T.line};border-radius:14px;padding:0">
   <img src="${APP_URL}/email-actor-cards-v3.jpg" width="520" alt="Two CastSlate actor cards with QR codes" style="display:block;width:100%;max-width:520px;height:auto;border:0;margin:0 auto;border-radius:13px"/>
  </td></tr></table>
 </td></tr>

 <tr><td class="p" align="center" style="padding:28px 40px 38px">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr><td align="center" style="background:${T.barSolid};background:${T.btn};border-radius:12px">
   <a href="${APP_URL}/membership" style="display:block;padding:18px 40px;font-size:16px;font-weight:800;letter-spacing:.2px;color:#fff;text-decoration:none">Unlock the Agency Directory &nbsp;&#9654;</a>
  </td></tr></table>
  <div style="margin-top:14px;font-size:12.5px;color:#8a8271">Included with Premium &middot; cancel any time</div>
 </td></tr>
 ${csFooterStripe(T.barSolid)}
</table>
</td></tr></table>
${csFooterA("You&rsquo;re receiving this because you recently created a CastSlate account.", T.accent, unsubUrl)}
</body></html>`;
}

async function sendBatch(items: { email:string; subject:string; html:string }[]):
    Promise<{ ok:boolean; ids:(string|null)[]; err:string|null }> {
  if (!RESEND_API_KEY) return { ok:false, ids:[], err:"RESEND_API_KEY not set" };
  const payload = items.map((i) => ({ from:FROM_EMAIL, to:[i.email], subject:i.subject, html:i.html }));
  const r = await fetch("https://api.resend.com/emails/batch", {
    method:"POST",
    headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  if (!r.ok) return { ok:false, ids:[], err:`Resend ${r.status}: ${txt.slice(0,300)}` };
  let ids:(string|null)[] = [];
  try { ids = (JSON.parse(txt)?.data ?? []).map((d:{id?:string}) => d?.id ?? null); } catch { /* ignore */ }
  return { ok:true, ids, err:null };
}

// 0-23 hour in New York right now. Intl handles daylight saving, so the cron can run
// on a plain hourly schedule and the 2 PM rule stays correct all year.
function hourInNewYork(): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", hour:"numeric", hourCycle:"h23" })
    .formatToParts(new Date()).find((p) => p.type === "hour")?.value ?? "0";
  return Number(h) % 24;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── GET unsubscribe: public, no auth (the link lives in the email footer) ──
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    const uid = (url.searchParams.get("uid") ?? "").trim();
    const page = (msg: string) =>
      new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>CastSlate</title></head><body style="margin:0;background:#F3EEE6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:420px;margin:90px auto;padding:34px 28px;background:#fff;border-radius:16px;text-align:center"><div style="font-size:18px;font-weight:800;letter-spacing:2px;color:#1A1A2E">CASTSLATE</div><p style="margin:18px 0 0;font-size:16px;line-height:1.6;color:#3A322A">${msg}</p></div></body></html>`,
        { status:200, headers:{ ...cors, "Content-Type":"text/html; charset=utf-8" } });
    if (!/^[0-9a-f-]{36}$/i.test(uid)) return page("That link was incomplete.");
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await admin.from("email_preferences").upsert(
      { user_id:uid, announce_optout:true, updated_at:new Date().toISOString() },
      { onConflict:"user_id" });
    return page("You're unsubscribed from announcements.");
  }

  // ── auth ──
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const authorized = !!token && (token === SUPABASE_SERVICE_KEY || (!!ADMIN_SECRET && token === ADMIN_SECRET));
  if (!authorized) return res({ error:"Unauthorized" }, 401);

  let body:Record<string,unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? "dry_run");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── TEST: one address, never logged ──
  if (action === "test") {
    const to = String(body.to_email ?? "").trim();
    if (!to) return res({ error:"to_email required" }, 400);
    const first = String(body.first_name ?? "Marian").trim() || "there";
    const r = await sendBatch([{ email:to, subject:`[TEST] ${SUBJECT}`, html:introHtml(first, `${UNSUB_BASE}?action=unsubscribe&uid=preview`, body.has_headshot !== false) }]);
    return res({ ok:r.ok, error:r.err, to });
  }

  if (!["dry_run","run"].includes(action)) return res({ error:"Unknown action" }, 400);

  // Quiet hours: someone who signs up at midnight is mailed at 8 AM, not 3 AM.
  const hourNow = hourInNewYork();
  const inWindow = (hourNow >= WINDOW_START_NY && hourNow < WINDOW_END_NY) || body.force_hour === true;

  const { data: rows, error } = await sb.rpc("agd_intro_eligible", { p_limit: MAX_PER_RUN });
  if (error) return res({ error:`eligibility: ${error.message}` }, 500);
  const people = (rows ?? []) as { id:string; first_name:string|null; email:string; has_headshot:boolean }[];

  if (action === "dry_run" || !inWindow) {
    return res({ ok:true, dry_run: action === "dry_run", sent:0, eligible:people.length, ny_hour:hourNow,
      note: action === "run" ? `outside the ${WINDOW_START_NY}:00-${WINDOW_END_NY}:00 New York window; nothing sent` : undefined });
  }
  if (!people.length) return res({ ok:true, sent:0, eligible:0, ny_hour:hourNow });

  let sent = 0, failed = 0;
  for (let i = 0; i < people.length; i += 100) {
    const chunk = people.slice(i, i + 100);
    const r = await sendBatch(chunk.map((p) => ({
      email: p.email, subject: SUBJECT,
      html: introHtml(p.first_name && p.first_name !== "there" ? p.first_name : "there", `${UNSUB_BASE}?action=unsubscribe&uid=${p.id}`, p.has_headshot),
    })));
    if (!r.ok) { failed += chunk.length; console.error("agd-intro batch failed:", r.err); continue; }
    // Stamp the once-only guard ONLY after Resend accepted the batch.
    const logRows = chunk.map((p, k) => ({
      announce_key: ANNOUNCE_KEY, user_id: p.id, email: p.email, variant: VARIANT, provider_id: r.ids[k] ?? null,
    }));
    const { error: logErr } = await sb.from("member_announce_logs")
      .upsert(logRows, { onConflict:"announce_key,user_id", ignoreDuplicates:true });
    if (logErr) console.error("agd-intro log failed (people WERE mailed):", logErr.message);
    sent += chunk.length;
  }
  return res({ ok:true, sent, failed, eligible:people.length, ny_hour:hourNow });
});

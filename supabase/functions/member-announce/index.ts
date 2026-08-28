// member-announce — Supabase Edge Function
// One-off product announcements to REGISTERED members (not CSV promo lists).
//
// POST { action:"count",  audience }                  → dry run: who would get it, no send.
// POST { action:"test",   to_email, variant }         → single preview send, never logged.
// POST { action:"run",    audience, confirm:true }    → the real send.
// POST { action:"send_one", user_id, force? }         → this announcement, to one
//     named member, immediately. Driven by the button on a talent's card in the
//     admin Headshot Catalog. Same suppression checks and same log row as a bulk
//     send; force:true is the only way to re-send to somebody already logged.
//
// audience: "premium" | "free" | "both"
// variant:  "premium" | "free"   (test only; run picks per-recipient automatically)
//
// Why this is safe to run more than once:
//   • Every successful send is logged to member_announce_logs with a UNIQUE
//     (user_id, announce_key). A second run skips anyone already sent — so a
//     double-click, a retry after a timeout, or a re-run to catch new signups
//     can never mail the same person twice.
//   • Recipients resolve AT SEND TIME from profiles.membership_status, so the
//     premium/free split is always current. A member who upgrades between the
//     count and the run gets the premium copy, not the upsell.
//   • Hard bounces + complaints (email_unsubscribes, fed by resend-webhook) are
//     suppressed. So is anyone who globally unsubscribed (email_preferences
//     .unsubscribed_at) or opted out of announcements (announce_optout) — the
//     same dedicated-column convention premium-upsell and winback-run use.
//
//   • "run" requires confirm:true. Without it the function refuses and returns
//     the count instead — no accidental blast from a stray request.
//
// GET ?action=unsubscribe&uid=<id> → opt out of announcements only (keeps the
//     casting digest and every other email intact).
//
// Auth: service-role key OR the shared admin campaign secret (mirrors send-campaign).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const FROM_EMAIL           = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "";

// Bump this to send a NEW announcement to everyone again.
// Deliberately still v1 after the 2026-08-28 rewrite: the copy, the studio strip,
// the business cards and the per-member personalisation are all new, but bumping
// the key would re-mail the ~515 members who already received the first version.
// Anyone who should get the new one individually is sent from the Headshot Catalog
// with force:true instead.
const ANNOUNCE_KEY = "agency_directory_v1";
const UNSUB_BASE   = `${SUPABASE_URL}/functions/v1/member-announce`;

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
};
const res = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status:s, headers:{ ...cors, "Content-Type":"application/json" } });

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c] as string));

// A display_name is not guaranteed to be a name. Google sign-ups used to store
// the email handle there, so a real send once opened with "Hi officece,". Anything
// that reads like a handle — digits, dots/underscores, or the local part of the
// address we are mailing — is dropped rather than printed.
function firstName(displayName: string | null, email: string): string {
  const raw = String(displayName ?? "").trim();
  const first = raw.split(/\s+/)[0] ?? "";
  const local = String(email ?? "").split("@")[0].toLowerCase();
  const bad = !first
    || first.length < 2
    || /[0-9._@]/.test(first)
    || first.toLowerCase() === local
    || local.startsWith(first.toLowerCase());
  return bad ? "there" : first;
}

// ── Warm Tonal shell (amber), identical in structure to send-notification-email ──
const T = { solid:"#B4711A", soft:"#FCF2E3", gold:"#F0B860", ink:"#1A1A2E", body:"#5A5A72", cream:"#FBF8F1" };

// Real counts, straight off TALENT_AGENCIES in the app: 663 companies =
// 354 talent agencies + 309 management companies. 528 keep a Los Angeles-area
// office (125 of those in Beverly Hills), 197 keep a New York office, 62 both.
// If that array grows, these move with it — the email must not claim a number
// the directory cannot show.
const DIR = { total:663, agencies:354, mgmt:309, la:528, bh:125, ny:197, both:62 };

interface CityFacts { label:string; line:string }
// profiles.location is free text from the shared signup/profile list, so match on
// substrings — and always fall back to a line that is true for everyone.
function cityFacts(loc: string | null): CityFacts {
  const l = String(loc ?? "").toLowerCase();
  if (/beverly hills/.test(l))
    return { label:"Beverly Hills", line:`<strong style="color:${T.ink}">${DIR.bh} of them are in Beverly Hills alone</strong>, and ${DIR.la} across greater Los Angeles. You could walk to a good number of these offices.` };
  if (/los angeles|\bla\b|burbank|hollywood|studio city|pasadena|santa monica|glendale|long beach|california|, ca/.test(l))
    return { label:"Los Angeles", line:`<strong style="color:${T.ink}">${DIR.la} of them keep a Los Angeles-area office</strong> &mdash; ${DIR.bh} in Beverly Hills alone. That is a mailing list you can work through in an afternoon.` };
  if (/new york|nyc|brooklyn|queens|bronx|manhattan|newark|jersey|, ny/.test(l))
    return { label:"New York", line:`<strong style="color:${T.ink}">${DIR.ny} of them keep a New York office</strong>, and ${DIR.both} work both coasts &mdash; so a New York letter can still reach a Los Angeles desk.` };
  return { label:"", line:`<strong style="color:${T.ink}">Where you live does not decide who you can approach.</strong> ${DIR.both} of these companies work both coasts, and the rest read mail from out of state every week of the year.` };
}

// Masthead. This is the part that read as broken on a phone: a two-column table
// put the wordmark and the tag side by side, so at 390px the tag wrapped onto two
// lines beside a cramped logo tile. One centred column now — and the wordmark is
// set as "CastSlate", never CASTSLATE.
function masthead(tag: string): string {
  return `<tr><td class="cs-mast" style="background:#000000;padding:26px 24px 20px;text-align:center">
    <img src="${APP_URL}/logo-email-tile.png" alt="" width="46" height="46" style="display:inline-block;width:46px;height:46px;border-radius:11px;border:1px solid rgba(255,255,255,.14)"/>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${T.cream};letter-spacing:.2px;margin:11px 0 0;line-height:1.1">CastSlate</div>
    <div style="margin:13px 0 0"><span style="display:inline-block;border:1px solid rgba(240,184,96,.5);border-radius:999px;padding:5px 13px;font-size:9.5px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${T.gold}">${tag}</span></div>
  </td></tr>`;
}

function kickerBar(kicker: string): string {
  return `<tr><td style="background:#000000;padding:16px 22px 20px;text-align:center">
    <div style="height:1px;background:linear-gradient(90deg,rgba(240,184,96,0),#F0B860,rgba(240,184,96,0));margin:0 0 14px;font-size:0;line-height:0">&nbsp;</div>
    <div style="font-size:10px;font-weight:800;letter-spacing:2.6px;text-transform:uppercase;color:${T.gold};line-height:1.7">${kicker}</div>
  </td></tr>`;
}

// The "this is yours specifically" card. Every line in it is a real fact about the
// person reading it — their own city, their own submission count — so the email can
// say it was picked for them without the claim being decoration.
function youCard(first: string, facts: CityFacts, subs: number, hasReel: boolean): string {
  const effort = subs >= 8
    ? `You have put yourself forward <strong style="color:${T.ink}">${subs} times</strong> on CastSlate. People who submit like that are not testing the water, and this is the next lever you have not pulled yet.`
    : subs >= 1
      ? `You have submitted <strong style="color:${T.ink}">${subs} time${subs === 1 ? "" : "s"}</strong> so far. Submitting is one half of the job; the other half is that somebody with a phone full of casting directors already knows your name.`
      : `Your profile is up, which is more than most people manage. The step after the profile is not another audition site &mdash; it is representation.`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr>
    <td style="background:${T.soft};border:1px solid rgba(180,113,26,.28);border-left:3px solid ${T.solid};border-radius:10px;padding:18px 20px">
      <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${T.solid};margin:0 0 9px">Why this one is for you, ${esc(first)}</div>
      <div style="font-size:14.5px;line-height:1.75;color:${T.body};margin:0 0 10px">${effort}</div>
      <div style="font-size:14.5px;line-height:1.75;color:${T.body}">${facts.line}</div>
      ${hasReel ? `<div style="font-size:13px;line-height:1.7;color:${T.body};margin-top:10px;padding-top:10px;border-top:1px solid rgba(180,113,26,.22)">You already have video on your profile. That is the thing an agent actually wants to see &mdash; and the QR code below is how they see it without downloading anything.</div>` : ""}
    </td></tr></table>`;
}

// The decades line the whole email hangs on.
const KNOWLEDGE = `<p style="margin:0 0 22px;font-size:15.5px;line-height:1.8;color:${T.body}">Most of what separates a working actor from a talented one is not talent. It is knowing which door opens. Which offices are real and still trading. Which will read an envelope from somebody they have never heard of, and which will hand it straight back unopened. Which are agents and which are managers, and why that changes what you write. <strong style="color:${T.ink}">That knowledge normally takes twenty or thirty years to collect, one closed door at a time.</strong> We collected it and put it in one place.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="border-left:3px solid ${T.gold};padding:2px 0 2px 16px">
  <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:19px;line-height:1.45;color:${T.ink}">A little knowledge takes you a lot further than a lot of hope.</div>
</td></tr></table>`;

const GATE = `<p style="margin:0 0 22px;font-size:15px;line-height:1.75;color:${T.body}">Worth saying plainly: the Marvel films, the DC films, the hundred-million-dollar features &mdash; <strong style="color:${T.ink}">those roles are never posted publicly, anywhere.</strong> They are submitted by agents and managers only. Whatever stage you are at, that is the door this list is about.</p>`;

function block(kicker: string, title: string, sub: string, stats?: [string,string][]): string {
  const statRow = stats
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:15px;border-top:1px solid rgba(180,113,26,.22)"><tr>${
        stats.map(([n,l]) => `<td style="padding-top:13px" align="center" width="33%"><div style="font-size:21px;font-weight:800;color:${T.ink};line-height:1;font-family:Georgia,serif">${n}</div><div style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#8a8271;margin-top:5px;line-height:1.4">${l}</div></td>`).join("")
      }</tr></table>`
    : "";
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr>
      <td style="background:${T.soft};border:1px solid rgba(180,113,26,.28);border-left:3px solid ${T.solid};border-radius:10px;padding:18px 20px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${T.solid};margin:0 0 8px">${kicker}</div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:${T.ink};line-height:1.25">${title}</div>
        <div style="font-size:14px;color:${T.body};margin-top:6px;line-height:1.65">${sub}</div>
        ${statRow}
      </td></tr></table>`;
}

// The six studio marks exactly as AGD_STUDIOS shows them on the Agency Directory
// page, baked to one raster because no mail client renders SVG. Regenerate the PNG
// from the same /logos/*.svg files if a mark is ever replaced.
function studioStrip(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="background:${T.cream};border:1px solid #EFE7D6;border-radius:10px;padding:18px 12px 14px;text-align:center">
      <div style="font-size:9.5px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:#9a9382;margin:0 0 14px">The films their clients get cast in</div>
      <img src="${APP_URL}/email-agd-studios.png" width="400" alt="Warner Bros. Pictures, Universal Pictures, Walt Disney Studios, Sony Pictures, Paramount Pictures, Marvel Studios" style="display:block;width:100%;max-width:400px;height:auto;margin:0 auto;border:0"/>
    </td></tr></table>`;
}

// The real Actor Business Cards, QR codes and all — the same raster the weekly note
// uses, so the card shown here is the card they actually get.
function cardStrip(locked: boolean): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:#ffffff;border:1px solid #E7E7EF;border-radius:12px;padding:0;overflow:hidden">
      <img src="${APP_URL}/email-actor-cards.jpg" width="488" alt="Two Actor Business Cards, each with a headshot and a QR code" style="display:block;width:100%;max-width:488px;height:auto;border:0"/>
      <div style="padding:15px 18px 17px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${T.solid};margin:0 0 7px">${locked ? "Also included with Premium" : "Already in your dashboard"}</div>
        <div style="font-family:Georgia,serif;font-size:19px;font-weight:700;color:${T.ink};line-height:1.3">Your whole reel, in an agent&rsquo;s hand, on a card.</div>
        <div style="font-size:14px;color:${T.body};margin-top:6px;line-height:1.65">A mailed envelope takes four actions before anyone sees your face. Your card takes none. They scan the code and your headshots, self-tapes, credits and contact open on their phone &mdash; and when you update your profile tomorrow, the same card shows the new version.</div>
      </div>
    </td></tr></table>`;
}

function noteCard(first: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr>
    <td style="background:${T.ink};border-radius:12px;padding:19px 21px">
      <div style="font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:${T.gold};margin:0 0 9px">One of the seven tips &mdash; the handwritten note</div>
      <div style="font-family:Georgia,serif;font-style:italic;font-size:15.5px;line-height:1.7;color:${T.cream}">&ldquo;Hi, my name is ${esc(first)} and I&rsquo;m seeking representation in the TV and film industry. May I request an audition so you can see my abilities?&rdquo;</div>
      <div style="font-size:12.5px;color:rgba(251,248,241,.62);margin-top:11px;line-height:1.65">Write it by hand on the back of your card. One or two sentences. No biography, no how-you-found-them. Short reads as confident &mdash; and that is one tip out of seven, which is the smallest part of what is in there.</div>
    </td></tr></table>`;
}

interface ShellArgs { tag:string; kicker:string; heading:string; greeting:string; mid:string; cta:string; href:string; foot:string; preheader:string; unsub?:string; }
function shell(a: ShellArgs): string {
  const cta = `<table cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 0"><tr><td style="background:${T.solid};border-radius:10px" align="center">
      <a href="${APP_URL}${a.href}" style="display:block;padding:16px 34px;font-size:15px;font-weight:800;letter-spacing:.2px;color:${T.cream};text-decoration:none">${a.cta} &rarr;</a></td></tr></table>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  /* Phones. The inline styles hold on their own at 320px; this only buys back the
     side padding an iPhone was otherwise spending on nothing. */
  @media only screen and (max-width:600px){
    .cs-outer{padding:14px 10px !important}
    .cs-pad{padding-left:20px !important;padding-right:20px !important}
    .cs-h1{font-size:25px !important;line-height:1.2 !important}
    .cs-mast{padding:22px 16px 17px !important}
  }
</style></head>
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${a.preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" class="cs-outer" style="background:#f0f4f4;padding:36px 22px"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:${T.cream};border-radius:16px;overflow:hidden;border:1px solid #E1E8E8;box-shadow:0 4px 30px rgba(47,95,96,0.13)">
      ${masthead(a.tag)}
      <tr><td style="background:#000000;line-height:0;font-size:0">
        <img src="${APP_URL}/email/hero-hollywood-dusk.jpg" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0"/>
      </td></tr>
      ${kickerBar(a.kicker)}
      <tr><td class="cs-pad" style="padding:34px 36px 8px">
        <h1 class="cs-h1" style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:${T.ink};letter-spacing:-0.4px;line-height:1.18">${a.heading}</h1>
        <p style="margin:0 0 18px;font-size:15.5px;line-height:1.7;color:${T.body}">${a.greeting}</p>
        ${a.mid}
        ${cta}
      </td></tr>
      <tr><td class="cs-pad" style="padding:26px 36px 30px;border-top:1px solid #EFE7D6">
        <p style="margin:0;font-size:11.5px;color:#9a9382;line-height:1.7">${a.foot}<br/>Manage notifications in <a href="${APP_URL}/account-settings" style="color:${T.solid};text-decoration:none">Account Settings &rarr; Notifications</a>${a.unsub ? ` &middot; <a href="${a.unsub}" style="color:#9a9382;text-decoration:underline">Unsubscribe from announcements</a>` : ""}.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const STATS: [string,string][] = [[String(DIR.total),"Companies"],[String(DIR.agencies),"Talent agencies"],[String(DIR.mgmt),"Management cos."]];
const PREHEADER = `${DIR.total} agencies and management companies, and how each one wants to be approached.`;
const GREETING = (first: string) =>
  `Hi ${esc(first)}, this did not go out because you are on a list. It went out because of what your profile says about how you are going about this.`;

// Everything the two variants need to know about one recipient.
interface Person { first:string; location:string|null; subs:number; hasReel:boolean; unsub?:string }

function premiumHtml(p: Person): string {
  const facts = cityFacts(p.location);
  return shell({
    unsub:p.unsub,
    preheader:PREHEADER,
    tag:"Selected for you",
    kicker:"The gatekeepers, in one list",
    heading:`${DIR.total} doors &mdash; and which of them actually opens.`,
    greeting:GREETING(p.first),
    mid: youCard(p.first, facts, p.subs, p.hasReel)
      + KNOWLEDGE
      + block("Now in your dashboard","Talent Agency &amp; Management Directory",
          "Every talent agency and management company we could verify across Los Angeles, Beverly Hills and New York &mdash; sorted by size, so you can see at a glance which are open to new clients, which expect credits behind you, and which sign only through referral. For each one: the office address, the website, whether they are SAG-AFTRA franchised, and exactly how they want to be approached.", STATS)
      + studioStrip()
      + GATE
      + cardStrip(false)
      + noteCard(p.first),
    cta:"Open my directory", href:"/talent-dashboard",
    foot:"You&rsquo;re receiving this because you&rsquo;re a CastSlate Premium member.",
  });
}

function freeHtml(p: Person): string {
  const facts = cityFacts(p.location);
  return shell({
    unsub:p.unsub,
    preheader:PREHEADER,
    tag:"Selected for you",
    kicker:"The gatekeepers, in one list",
    heading:"The roles you cannot find online are behind these doors.",
    greeting:GREETING(p.first),
    mid: youCard(p.first, facts, p.subs, p.hasReel)
      + KNOWLEDGE
      + block("New &mdash; included with Premium","Talent Agency &amp; Management Directory",
          "Every talent agency and management company we could verify across Los Angeles, Beverly Hills and New York &mdash; sorted small, mid-size, major and management, so you can tell who is open to new clients and who will send an unsolicited envelope straight back. Members see the office address, the website, the SAG-AFTRA status and how each one takes submissions.", STATS)
      + studioStrip()
      + GATE
      + cardStrip(true)
      + noteCard(p.first),
    cta:"See what&rsquo;s inside", href:"/membership",
    foot:"You&rsquo;re receiving this because you have a CastSlate account.",
  });
}

const SUBJECT = {
  premium: `${DIR.total} doors — and which of them actually opens`,
  free:    "The roles you cannot find online are behind these doors",
};

interface Outbox { userId:string; email:string; variant:"premium"|"free"; subject:string; html:string; }

// How many times this person has actually submitted. Cosmetic only — the copy has
// a sensible branch for 0 — so a failure here logs and returns nothing rather than
// blocking a send.
async function submissionCounts(
  // deno-lint-ignore no-explicit-any
  sb: any, uids: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100);
    let from = 0;
    while (true) {
      const { data, error } = await sb.from("applications").select("talent_id").in("talent_id", chunk).range(from, from + 999);
      if (error) { console.error("[member-announce] submissionCounts", error); break; }
      if (!data?.length) break;
      data.forEach((r: { talent_id?: string }) => { if (r.talent_id) counts[r.talent_id] = (counts[r.talent_id] ?? 0) + 1; });
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  return counts;
}

async function sendBatch(items: Outbox[]): Promise<{ ok:boolean; ids:(string|null)[]; err:string|null }> {
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── GET unsubscribe: public, no auth (the link lives in the email footer) ──
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    const uid = (url.searchParams.get("uid") ?? "").trim();
    const page = (msg: string) =>
      new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>CastSlate</title></head><body style="margin:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><table width="100%" style="padding:60px 22px"><tr><td align="center"><table width="460" style="max-width:460px;background:#FBF8F1;border-radius:16px;border:1px solid #E1E8E8"><tr><td style="padding:34px 32px"><h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px;color:#1A1A2E">${msg}</h1><p style="margin:0;font-size:14px;line-height:1.7;color:#5A5A72">You will still receive your casting digest and account emails. Change anything in <a href="${APP_URL}/account-settings" style="color:#B4711A">Account Settings</a>.</p></td></tr></table></td></tr></table></body></html>`,
        { status:200, headers:{ ...cors, "Content-Type":"text/html; charset=utf-8" } });
    if (!uid) return page("That link was incomplete.");
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await admin.from("email_preferences").upsert(
      { user_id:uid, announce_optout:true, updated_at:new Date().toISOString() },
      { onConflict:"user_id" });
    return page("You're unsubscribed from announcements.");
  }

  // ── auth ──
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  let authorized = token && (token === SUPABASE_SERVICE_KEY || (!!ADMIN_SECRET && token === ADMIN_SECRET));
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  if (!authorized && token) {
    const { data:{ user } } = await sb.auth.getUser(token);
    if (user) {
      const { data:prof } = await sb.from("profiles").select("user_type").eq("id", user.id).maybeSingle();
      if (prof && ["admin","super_admin"].includes(prof.user_type)) authorized = true;
    }
  }
  if (!authorized) return res({ error:"Unauthorized" }, 401);

  let body:Record<string,unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action   = String(body.action ?? "count");
  const audience = String(body.audience ?? "both");
  if (!["premium","free","both"].includes(audience)) return res({ error:"bad audience" }, 400);

  // ── TEST: one address, never logged ──
  // The personal card needs a person, so a test with no profile behind it gets a
  // representative one rather than an empty shell — otherwise the preview cannot
  // show the part of the email you are actually reviewing.
  if (action === "test") {
    const to = String(body.to_email ?? "").trim();
    if (!to) return res({ error:"to_email required" }, 400);
    const variant = body.variant === "free" ? "free" : "premium";
    const person: Person = {
      first: firstName(String(body.first_name ?? ""), to),
      location: body.location == null ? "Los Angeles, CA" : String(body.location),
      subs: Number.isFinite(Number(body.subs)) ? Number(body.subs) : 12,
      hasReel: body.has_reel !== false,
      unsub: `${UNSUB_BASE}?action=unsubscribe&uid=preview`,
    };
    const html = variant === "premium" ? premiumHtml(person) : freeHtml(person);
    const r = await sendBatch([{ userId:"test", email:to, variant, subject:`[TEST] ${SUBJECT[variant]}`, html }]);
    return res({ ok:r.ok, error:r.err, variant, to });
  }

  // ── SEND_ONE: this announcement, to one named member, right now ──
  // Driven by the button on a talent's card in the admin Headshot Catalog. It runs
  // the same suppression checks as a bulk send and writes the same log row, so a
  // member mailed here is skipped by the next bulk run. The one difference is that
  // an admin who has picked a specific person can override "already sent" with
  // force:true — the bulk path can never do that.
  if (action === "send_one") {
    const uid = String(body.user_id ?? "").trim();
    if (!uid) return res({ error:"user_id required" }, 400);
    const force = body.force === true;

    const { data:prof, error:profErr } = await sb.from("profiles")
      .select("id,display_name,membership_status,location,video_links,account_status")
      .eq("id", uid).maybeSingle();
    if (profErr) return res({ error:`Could not load that member: ${profErr.message}` }, 500);
    if (!prof)   return res({ error:"No profile with that id" }, 404);

    const { data:emailRows, error:emailErr } = await sb.rpc("get_member_emails", { uids:[uid] });
    if (emailErr) return res({ error:`Could not read that member's email: ${emailErr.message}` }, 500);
    const email = String((emailRows ?? [])[0]?.email ?? "").trim();
    if (!email) return res({ error:"That member has no email address on file" }, 400);

    // Suppression and opt-out are never overridable — force only covers "already sent".
    const { data:sup } = await sb.from("email_unsubscribes").select("email").eq("email", email.toLowerCase()).maybeSingle();
    if (sup) return res({ error:"That address is suppressed (hard bounce or spam complaint). Not sending." }, 409);
    const { data:pref } = await sb.from("email_preferences").select("announce_optout,unsubscribed_at").eq("user_id", uid).maybeSingle();
    if (pref?.announce_optout === true || pref?.unsubscribed_at) return res({ error:"That member has opted out of announcement email. Not sending." }, 409);

    const { data:prev } = await sb.from("member_announce_logs")
      .select("sent_at,variant").eq("announce_key", ANNOUNCE_KEY).eq("user_id", uid).maybeSingle();
    if (prev && !force) {
      return res({ ok:true, sent:false, already_sent:true, sent_at:prev.sent_at ?? null, variant:prev.variant ?? null, email });
    }

    const counts = await submissionCounts(sb, [uid]);
    const variant:"premium"|"free" = prof.membership_status === "active" ? "premium" : "free";
    const person: Person = {
      first: firstName(prof.display_name, email),
      location: prof.location ?? null,
      subs: counts[uid] ?? 0,
      hasReel: Array.isArray(prof.video_links) && prof.video_links.length > 0,
      unsub: `${UNSUB_BASE}?action=unsubscribe&uid=${uid}`,
    };
    const html = variant === "premium" ? premiumHtml(person) : freeHtml(person);
    const r = await sendBatch([{ userId:uid, email, variant, subject:SUBJECT[variant], html }]);
    if (!r.ok) return res({ ok:false, sent:false, error:r.err ?? "send failed" }, 502);

    // Logged only after the send succeeded, same rule as the bulk path.
    const { error:logErr } = await sb.from("member_announce_logs").upsert(
      [{ announce_key:ANNOUNCE_KEY, user_id:uid, email, variant, provider_id:r.ids[0] ?? null }],
      { onConflict:"announce_key,user_id", ignoreDuplicates:false });
    if (logErr) console.error("[member-announce] send_one log error", logErr);

    return res({ ok:true, sent:true, resent:!!prev, variant, email, first:person.first,
                 personalised:{ location:person.location, submissions:person.subs, has_video:person.hasReel } });
  }

  // ── resolve recipients ──
  const profiles:{ id:string; display_name:string|null; membership_status:string|null; location:string|null; video_links:unknown }[] = [];
  {
    const PAGE = 1000; let from = 0;
    while (true) {
      let q = sb.from("profiles")
        .select("id,display_name,membership_status,location,video_links")
        .in("user_type", ["talent","actor"])
        .eq("account_status","active")
        .order("created_at", { ascending:true })
        .range(from, from + PAGE - 1);
      if (audience === "premium") q = q.eq("membership_status","active");
      if (audience === "free")    q = q.or("membership_status.is.null,membership_status.neq.active");
      const { data, error } = await q;
      if (error) { console.error("[member-announce] profiles", error); break; }
      if (!data?.length) break;
      profiles.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  if (!profiles.length) return res({ ok:true, audience, eligible:0, sent:0, skipped:0, message:"No eligible members" });

  const uids = profiles.map((p) => p.id);

  // emails (authoritative, from auth.users)
  // NOTE: get_member_emails, NOT get_digest_emails. The digest RPC deliberately
  // excludes membership_status='active' because Premium do not get the casting
  // digest — reusing it here silently dropped every Premium member.
  const emailMap:Record<string,string> = {};
  let emailsOk = true;
  for (let i = 0; i < uids.length; i += 500) {
    const { data, error } = await sb.rpc("get_member_emails", { uids: uids.slice(i, i + 500) });
    if (error) { console.error("[member-announce] get_member_emails", error); emailsOk = false; break; }
    (data ?? []).forEach((r:{id?:string; email?:string}) => { if (r?.id && r?.email) emailMap[r.id] = r.email; });
  }

  // opt-outs: announcement-specific, plus anyone globally unsubscribed
  const optedOut = new Set<string>();
  let optedOutOk = true;
  for (let i = 0; i < uids.length; i += 100) {
    const { data, error } = await sb.from("email_preferences").select("user_id,announce_optout,unsubscribed_at").in("user_id", uids.slice(i, i + 100));
    if (error) { console.error("[member-announce] optedOut chunk failed", error); optedOutOk = false; break; }
    (data ?? []).forEach((p:{user_id:string; announce_optout?:boolean; unsubscribed_at?:string|null}) => {
      if (p.announce_optout === true || p.unsubscribed_at) optedOut.add(p.user_id);
    });
  }

  // hard bounces + complaints
  const suppressed = new Set<string>();
  {
    const PAGE = 1000; let from = 0;
    while (true) {
      const { data, error } = await sb.from("email_unsubscribes").select("email").range(from, from + PAGE - 1);
      if (error) break;
      if (!data?.length) break;
      data.forEach((r:{email?:string}) => { if (r.email) suppressed.add(String(r.email).trim().toLowerCase()); });
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // already sent this announcement
  // Chunks must stay small: .in() becomes a GET query string, and 500 UUIDs is a
  // ~19KB URL that fails on length. That failure previously went unnoticed because
  // the error was discarded, so the run thought nobody had been sent and offered to
  // re-mail 442 people who already had it. Fail CLOSED instead: if this lookup is
  // incomplete we refuse to send, because the alternative is mass duplicate email.
  const alreadySent = new Set<string>();
  let alreadySentOk = true;
  for (let i = 0; i < uids.length; i += 100) {
    const { data, error } = await sb.from("member_announce_logs")
      .select("user_id").eq("announce_key", ANNOUNCE_KEY).in("user_id", uids.slice(i, i + 100));
    if (error) { console.error("[member-announce] alreadySent chunk failed", error); alreadySentOk = false; break; }
    (data ?? []).forEach((r:{user_id:string}) => alreadySent.add(r.user_id));
  }

  // Per-person submission counts, for the "why this is for you" card.
  const subCounts = await submissionCounts(sb, uids);

  const outbox:Outbox[] = [];
  const skip = { no_email:0, suppressed:0, opted_out:0, already_sent:0 };
  for (const p of profiles) {
    if (alreadySent.has(p.id)) { skip.already_sent++; continue; }
    const email = (emailMap[p.id] ?? "").trim();
    if (!email) { skip.no_email++; continue; }
    if (suppressed.has(email.toLowerCase())) { skip.suppressed++; continue; }
    if (optedOut.has(p.id)) { skip.opted_out++; continue; }
    const variant:"premium"|"free" = p.membership_status === "active" ? "premium" : "free";
    const person: Person = {
      first: firstName(p.display_name, email),
      location: p.location ?? null,
      subs: subCounts[p.id] ?? 0,
      hasReel: Array.isArray(p.video_links) && p.video_links.length > 0,
      unsub: `${UNSUB_BASE}?action=unsubscribe&uid=${p.id}`,
    };
    outbox.push({ userId:p.id, email, variant, subject:SUBJECT[variant], html: variant === "premium" ? premiumHtml(person) : freeHtml(person) });
  }

  const counts = {
    audience,
    eligible: profiles.length,
    to_send: outbox.length,
    premium: outbox.filter((o) => o.variant === "premium").length,
    free: outbox.filter((o) => o.variant === "free").length,
    skipped: skip,
  };

  // count-only, or a run without explicit confirmation → report, never send
  // Any incomplete lookup means the skip lists are untrustworthy — refuse to send.
  if (!alreadySentOk || !optedOutOk || !emailsOk) {
    return res({ ok:false, error:"Recipient checks did not complete — refusing to send so nobody is emailed twice. Try again.",
                 detail:{ already_sent_ok:alreadySentOk, opted_out_ok:optedOutOk, emails_ok:emailsOk } }, 503);
  }

  if (action !== "run" || body.confirm !== true) {
    return res({ ok:true, dry_run:true, ...counts, note: action === "run" ? "confirm:true required to send" : undefined });
  }

  // ── send ──
  let sent = 0; const errors:string[] = [];
  for (let i = 0; i < outbox.length; i += 100) {
    const chunk = outbox.slice(i, i + 100);
    const r = await sendBatch(chunk);
    if (!r.ok) { errors.push(r.err ?? "send failed"); continue; }
    const rows = chunk.map((c, n) => ({
      announce_key: ANNOUNCE_KEY, user_id: c.userId, email: c.email,
      variant: c.variant, provider_id: r.ids[n] ?? null,
    }));
    // log AFTER a successful send, so a failure never marks someone as done
    const { error } = await sb.from("member_announce_logs").upsert(rows, { onConflict:"announce_key,user_id", ignoreDuplicates:true });
    if (error) console.error("[member-announce] log error", error);
    sent += chunk.length;
  }

  return res({ ok: errors.length === 0, ...counts, sent, errors: errors.slice(0, 5) });
});

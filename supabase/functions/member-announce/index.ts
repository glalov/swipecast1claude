// member-announce — Supabase Edge Function
// One-off product announcements to REGISTERED members (not CSV promo lists).
//
// POST { action:"count",  audience }                  → dry run: who would get it, no send.
// POST { action:"test",   to_email, variant }         → single preview send, never logged.
// POST { action:"run",    audience, confirm:true }    → the real send.
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

// ── Warm Tonal shell (amber), identical in structure to send-notification-email ──
const T = { grad:"linear-gradient(150deg,#A85F13 0%,#E0871F 70%,#b96c16 100%)", solid:"#B4711A", soft:"#FCF2E3", rule:"rgba(255,236,206,.55)" };

function csLogo(): string {
  return `<span style="display:inline-block;background:#FBF8F1;border-radius:8px;padding:8px;line-height:0;vertical-align:middle;box-shadow:0 3px 10px rgba(0,0,0,0.18)"><img src="${APP_URL}/logo-email.png" alt="CastSlate" width="22" height="22" style="display:block"/></span>`;
}

function block(kicker: string, title: string, sub: string, stats?: [string,string][]): string {
  const statRow = stats
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid rgba(180,113,26,.22)"><tr>${
        stats.map(([n,l]) => `<td style="padding-top:12px" align="center"><div style="font-size:19px;font-weight:800;color:#1A1A2E;line-height:1">${n}</div><div style="font-size:9.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#8a8271;margin-top:4px">${l}</div></td>`).join("")
      }</tr></table>`
    : "";
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr>
      <td style="background:${T.soft};border:1px solid ${T.solid}2b;border-left:3px solid ${T.solid};border-radius:10px;padding:18px 20px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${T.solid};margin:0 0 8px">${kicker}</div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1A1A2E;line-height:1.25">${title}</div>
        <div style="font-size:14px;color:#5A5A72;margin-top:5px;line-height:1.6">${sub}</div>
        ${statRow}
      </td></tr></table>`;
}

function noteCard(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr>
    <td style="background:#1A1A2E;border-radius:12px;padding:18px 20px">
      <div style="font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:#F0B860;margin:0 0 8px">One of the seven tips: the handwritten note</div>
      <div style="font-family:Georgia,serif;font-style:italic;font-size:15px;line-height:1.65;color:#FBF8F1">&ldquo;Hi, my name is {{NAME}} and I&rsquo;m seeking representation in the TV and film industry. May I request an audition so you can see my abilities?&rdquo;</div>
      <div style="font-size:12px;color:rgba(251,248,241,.6);margin-top:10px;line-height:1.6">If you are approaching a new agency, write it by hand on the back of your card. One or two sentences. No biography, no how-you-found-them. Short reads as confident.</div>
    </td></tr></table>`;
}

const GATE = `<p style="margin:0 0 22px;font-size:15px;line-height:1.75;color:#5A5A72">Worth saying plainly: the Marvel films, the DC films, the hundred-million-dollar features &mdash; <strong style="color:#1A1A2E">those roles are never posted publicly, anywhere.</strong> They are submitted by agents and managers only. Whatever stage you are at, that is the door this list is about.</p>`;

interface ShellArgs { tag:string; kicker:string; heading:string; greeting:string; body:string; mid:string; cta:string; href:string; foot:string; unsub?:string; }
function shell(a: ShellArgs): string {

  const cta  = `<table cellpadding="0" cellspacing="0"><tr><td style="background:${T.solid};border-radius:10px"><a href="${APP_URL}${a.href}" style="display:inline-block;padding:15px 36px;font-size:14px;font-weight:800;letter-spacing:.2px;color:#FBF8F1;text-decoration:none">${a.cta} &rarr;</a></td></tr></table>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f0f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f4;padding:36px 22px"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#FBF8F1;border-radius:16px;overflow:hidden;border:1px solid #E1E8E8;box-shadow:0 4px 30px rgba(47,95,96,0.13)">
      <tr><td style="background:#000000;padding:16px 30px 14px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle">${csLogo()}<span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:17px;font-weight:800;letter-spacing:2px;color:#FBF8F1;text-transform:uppercase">CastSlate</span></td>
          <td align="right"><span style="font-size:9.5px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:#F0B860">${a.tag}</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#000000;line-height:0;font-size:0">
        <img src="${APP_URL}/email/hero-hollywood-dusk.jpg" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto"/>
      </td></tr>
      <tr><td style="background:#000000;padding:14px 30px 20px;text-align:center">
        <div style="height:1px;background:linear-gradient(90deg,rgba(240,184,96,0),#F0B860,rgba(240,184,96,0));margin:0 0 14px;font-size:0;line-height:0">&nbsp;</div>
        <div style="font-size:10px;font-weight:800;letter-spacing:3.4px;text-transform:uppercase;color:#F0B860">${a.kicker}</div>
      </td></tr>
      <tr><td style="padding:34px 36px 10px">
        <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#1A1A2E;letter-spacing:-0.4px;line-height:1.18">${a.heading}</h1>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#5A5A72">${a.greeting}</p>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.75;color:#5A5A72">${a.body}</p>
        ${a.mid}
        ${cta}
      </td></tr>
      <tr><td style="padding:24px 36px 30px;border-top:1px solid #EFE7D6">
        <p style="margin:0;font-size:11.5px;color:#9a9382;line-height:1.7">${a.foot}<br/>Manage notifications in <a href="${APP_URL}/account-settings" style="color:${T.solid};text-decoration:none">Account Settings &rarr; Notifications</a>${a.unsub ? ` &middot; <a href="${a.unsub}" style="color:#9a9382;text-decoration:underline">Unsubscribe from announcements</a>` : ""}.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const STATS: [string,string][] = [["312","Agencies"],["35","Open to submissions"],["7","Insider tips"]];

function premiumHtml(first: string, unsub?: string): string {
  return shell({
    unsub,
    tag:"New in Premium",
    kicker:"The gatekeepers, in one list",
    heading:"312 agencies &mdash; and the letter that actually gets opened.",
    greeting:`Hi ${esc(first)},`,
    body:"We have just added the <strong>Talent Agency Directory + Tips &amp; Tricks</strong> to your dashboard. It sits right under your Actor Business Card, and the two are built to work together: the card is what you send, the directory is where you send it.",
    mid: GATE
      + block("Now in your dashboard","Talent Agency Directory + Tips &amp; Tricks",
          "Every SAG-AFTRA franchised agency across Los Angeles and New York, sorted by size so you can see at a glance which are open to new clients, which expect credits behind you, and which sign only through referral &mdash; with the mailing address, the website and exactly how each one wants to be approached.", STATS)
      + block("Pair it with your card","Your Actor Business Card",
          "A mailed envelope takes four actions before anyone sees your face. Your card takes none &mdash; your headshot <em>is</em> the card, and the QR code opens your reels, photos, r&eacute;sum&eacute; and links in seconds on the agent&rsquo;s phone.")
      + noteCard().replace("{{NAME}}", esc(first)),
    cta:"Open my Directory", href:"/talent-dashboard",
    foot:"You&rsquo;re receiving this because you&rsquo;re a CastSlate Premium member.",
  });
}

function freeHtml(first: string, unsub?: string): string {
  return shell({
    unsub,
    tag:"New on CastSlate",
    kicker:"The gatekeepers, in one list",
    heading:"The roles you cannot find online are behind these doors.",
    greeting:`Hi ${esc(first)},`,
    body:"We have just launched the <strong>Talent Agency Directory + Tips &amp; Tricks</strong> &mdash; every SAG-AFTRA franchised talent agency across Los Angeles and New York, in one place, with the 62 our team verified one by one.",
    mid: GATE
      + block("New &mdash; Premium feature","Talent Agency Directory + Tips &amp; Tricks",
          "Sorted small, mid-size and major, so you can tell which are open to new clients, which expect credits, and which will send an unsolicited envelope straight back. Members see the mailing address, the website and how each agency wants to be approached.", STATS)
      + block("Included with Premium","Your Actor Business Card",
          "A card carrying your headshot and a QR code that opens your reels, photos and r&eacute;sum&eacute; on an agent&rsquo;s phone in seconds &mdash; no envelope to open, nothing to unfold.")
      + noteCard().replace("{{NAME}}", esc(first)),
    cta:"See what&rsquo;s inside", href:"/membership",
    foot:"You&rsquo;re receiving this because you have a CastSlate account.",
  });
}

const SUBJECT = {
  premium: "Your Premium account just got 312 talent agencies",
  free:    "312 talent agencies. 39 with mailing addresses.",
};

interface Outbox { userId:string; email:string; variant:"premium"|"free"; subject:string; html:string; }

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
  if (action === "test") {
    const to = String(body.to_email ?? "").trim();
    if (!to) return res({ error:"to_email required" }, 400);
    const variant = body.variant === "free" ? "free" : "premium";
    const first = String(body.first_name ?? "there").trim() || "there";
    const previewUnsub = `${UNSUB_BASE}?action=unsubscribe&uid=preview`;
    const html = variant === "premium" ? premiumHtml(first, previewUnsub) : freeHtml(first, previewUnsub);
    const r = await sendBatch([{ userId:"test", email:to, variant, subject:`[TEST] ${SUBJECT[variant]}`, html }]);
    return res({ ok:r.ok, error:r.err, variant, to });
  }

  // ── resolve recipients ──
  const profiles:{ id:string; display_name:string|null; membership_status:string|null }[] = [];
  {
    const PAGE = 1000; let from = 0;
    while (true) {
      let q = sb.from("profiles")
        .select("id,display_name,membership_status")
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
  for (let i = 0; i < uids.length; i += 1000) {
    const { data, error } = await sb.rpc("get_member_emails", { uids: uids.slice(i, i + 1000) });
    if (error) { console.error("[member-announce] get_member_emails", error); continue; }
    (data ?? []).forEach((r:{id?:string; email?:string}) => { if (r?.id && r?.email) emailMap[r.id] = r.email; });
  }

  // opt-outs: announcement-specific, plus anyone globally unsubscribed
  const optedOut = new Set<string>();
  for (let i = 0; i < uids.length; i += 300) {
    const { data } = await sb.from("email_preferences").select("user_id,announce_optout,unsubscribed_at").in("user_id", uids.slice(i, i + 300));
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
  const alreadySent = new Set<string>();
  for (let i = 0; i < uids.length; i += 500) {
    const { data } = await sb.from("member_announce_logs")
      .select("user_id").eq("announce_key", ANNOUNCE_KEY).in("user_id", uids.slice(i, i + 500));
    (data ?? []).forEach((r:{user_id:string}) => alreadySent.add(r.user_id));
  }

  const outbox:Outbox[] = [];
  const skip = { no_email:0, suppressed:0, opted_out:0, already_sent:0 };
  for (const p of profiles) {
    if (alreadySent.has(p.id)) { skip.already_sent++; continue; }
    const email = (emailMap[p.id] ?? "").trim();
    if (!email) { skip.no_email++; continue; }
    if (suppressed.has(email.toLowerCase())) { skip.suppressed++; continue; }
    if (optedOut.has(p.id)) { skip.opted_out++; continue; }
    const variant:"premium"|"free" = p.membership_status === "active" ? "premium" : "free";
    const first = (p.display_name ?? "").split(" ")[0].trim() || "there";
    const unsub = `${UNSUB_BASE}?action=unsubscribe&uid=${p.id}`;
    outbox.push({ userId:p.id, email, variant, subject:SUBJECT[variant], html: variant === "premium" ? premiumHtml(first, unsub) : freeHtml(first, unsub) });
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

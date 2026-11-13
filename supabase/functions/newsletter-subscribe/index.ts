// newsletter-subscribe — Supabase Edge Function (owner 2026-11-13)
// The footer box "New casting calls, by email" on castslate.com (signed-out visitors).
//
//   POST {email, hp, ms}           → save as pending + send ONE confirmation email (double opt-in)
//   GET  ?a=confirm&t=<token>      → confirm, put them at the FRONT of every campaign that is
//                                    currently sending, 302 to /browse-castings?subscribed=1
//   GET|POST ?a=unsub&t=<token>    → unsubscribe (global email_unsubscribes + campaign rows), 302 /unsubscribed
//
// Future campaigns: DB trigger cs_campaign_add_subscribers adds every confirmed subscriber to the
// front of a campaign when it launches (draft → sending). Registered users / premium members are
// still kept out by the campaign's own guards.
//
// Protection (public form, verify_jwt:false): hidden honeypot, ≥2.5s on page, ≤5 signups per
// hashed IP per hour, and the email_send_ledger guard: one confirmation per address per 24h.
// The response never reveals whether an address was already on the list.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { claimSends, releaseSends } from "../_shared/send-guard.ts";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL       = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL    = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const APP_URL          = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/, "");
const IP_SALT          = Deno.env.get("NEWSLETTER_IP_SALT") ?? "castslate-newsletter";
const FN_URL           = `${SUPABASE_URL}/functions/v1/newsletter-subscribe`;
const MAX_PER_IP_PER_HOUR = 5;
const MIN_MS_ON_PAGE      = 2500;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ALLOWED_ORIGINS = ["https://www.castslate.com", "https://castslate.com"];
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": allow, "Vary": "Origin",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken(): string {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const EMAIL_RE = /^[^\s@<>()",;:\\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

// ── Universal email footer "A · Cream Colophon", minus the "choose what you receive" link:
// subscribers have no account to manage. Unsubscribe stays. (Same markup as the other 7 emails.)
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
      <tr><td align="center" style="font-family:${sans};font-size:12.5px;color:#7A7064;padding-bottom:22px">To stop these emails, <a href="${unsubUrl}" style="color:${accent};text-decoration:underline">unsubscribe</a>.</td></tr>
      <tr><td align="center" style="padding-bottom:20px"><a href="${fb}" style="text-decoration:none"><table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr><td width="30" height="30" align="center" style="width:30px;height:30px;background:${accent};border-radius:15px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:30px;color:#FFFFFF;text-align:center">f</td></tr></table></a></td></tr>
      <tr><td align="center" style="border-top:1px solid #E2D9CB;padding-top:16px;font-family:${sans};font-size:11.5px;color:#A39684">&copy; ${new Date().getFullYear()} CastSlate &middot; <a href="mailto:team@castslate.com" style="color:#8A7A66;text-decoration:none">team@castslate.com</a></td></tr>
    </table>
  </td></tr>
</table>`;
}

const TYPE_COLOURS: Record<string, string> = { "Commercial": "#276551", "Independent Film": "#2B4A8A", "Feature Film": "#2B4A8A",
  "Short Film": "#2B4A8A", "Student Film": "#2B4A8A", "TV Pilot": "#6340B4", "TV Series": "#6340B4", "Web Series": "#6340B4",
  "Music Video": "#A2392A", "Theater": "#8A4A3C", "Off-Off-Broadway Theater": "#8A4A3C", "Off-Broadway Theater": "#8A4A3C" };
function money(n: unknown): string { const v = Number(n); if (!isFinite(v) || v <= 0) return ""; return "$" + (Number.isInteger(v) ? v.toString() : v.toFixed(2)); }
function payLine(c: any): string {
  const lo = money(c.rate_lo), hi = money(c.rate_hi), unit = c.rate_unit ? `/${c.rate_unit}` : "";
  if (!lo && !hi) return "";
  if (lo && hi && lo !== hi) return `Up to ${hi}${unit}`;
  return `${hi || lo}${unit}`;
}

function confirmEmail(email: string, confirmUrl: string, unsubUrl: string, castings: any[]): string {
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", serif = "Georgia,'Times New Roman',serif";
  const rows = castings.map((c) => {
    const url = `${APP_URL}/casting/${encodeURIComponent(c.slug)}?utm_source=newsletter&utm_medium=email&utm_campaign=confirm`;
    const col = TYPE_COLOURS[c.ctype] ?? "#8A7A66";
    const meta = [payLine(c), c.location].filter(Boolean).map(esc).join(" &middot; ");
    return `<tr><td style="padding:14px 0;border-top:1px solid #EEE7DC"><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
<td style="vertical-align:middle">
<div style="font-family:${sans};font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:${col}">${esc(c.ctype)}</div>
<div style="font-family:${serif};font-size:19px;font-weight:700;color:#1A1A2E;margin:3px 0 4px"><a href="${url}" style="color:#1A1A2E;text-decoration:none">${esc(c.title)}</a></div>
<div style="font-family:${sans};font-size:13px;color:#6E6458">${meta}</div></td>
<td width="92" align="right" style="vertical-align:middle"><a href="${url}" style="display:inline-block;font-family:${sans};font-size:13.5px;font-weight:700;color:#FFFFFF;background:#33826A;border-radius:10px;padding:10px 16px;text-decoration:none">Apply &#9656;</a></td>
</tr></table></td></tr>`;
  }).join("");
  const castingsBlock = rows ? `<tr><td style="padding:30px 30px 0"><div style="height:1px;background:#EEE7DC;line-height:1px;font-size:0">&nbsp;</div></td></tr>
<tr><td style="padding:24px 30px 6px;font-family:${sans};font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#8A7A66">Open right now</td></tr>
<tr><td style="padding:0 30px;font-family:${serif};font-size:22px;color:#1A1A2E">Castings you can apply to today</td></tr>
<tr><td style="padding:12px 30px 0"><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table></td></tr>` : "";
  const profileUrl = `${APP_URL}/register-talent?utm_source=newsletter&utm_medium=email&utm_campaign=confirm`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm your email</title></head>
<body style="margin:0;padding:0;background:#F3EEE6">
<div style="display:none;max-height:0;overflow:hidden">One click and casting calls start coming to your inbox.</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F3EEE6"><tr><td align="center" style="padding:28px 14px 0">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="padding:26px 30px 0"><table cellpadding="0" cellspacing="0" role="presentation"><tr>
<td style="padding-right:10px;vertical-align:middle"><img src="${APP_URL}/logo-email-tile.png" width="30" height="30" alt="CastSlate" style="display:block;border-radius:7px"/></td>
<td style="vertical-align:middle;font-family:${sans};font-size:15px;font-weight:800;letter-spacing:2.2px;color:#1A1A2E">CASTSLATE</td></tr></table></td></tr>
<tr><td style="padding:26px 30px 0;font-family:${serif};font-size:30px;line-height:1.2;color:#1A1A2E">One click and you're on the list.</td></tr>
<tr><td style="padding:14px 30px 0;font-family:${sans};font-size:16px;line-height:1.6;color:#3A322A">Confirm <b>${esc(email)}</b> and we'll send you casting calls from time to time, plus the occasional bit of CastSlate news.</td></tr>
<tr><td style="padding:24px 30px 0"><a href="${confirmUrl}" style="display:inline-block;font-family:${sans};font-size:16px;font-weight:700;color:#FFFFFF;background:#33826A;border-radius:10px;padding:14px 26px;text-decoration:none">Confirm my email &#9656;</a></td></tr>
<tr><td style="padding:14px 30px 0;font-family:${sans};font-size:13px;line-height:1.55;color:#8A7A66">Didn't ask for this? Just ignore this email and you won't hear from us.</td></tr>
${castingsBlock}
<tr><td style="padding:16px 30px 30px"><table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F7F3EC;border-radius:12px"><tr><td style="padding:20px 22px">
<div style="font-family:${sans};font-size:15px;font-weight:700;color:#1A1A2E">To apply, you'll need a free profile.</div>
<div style="font-family:${sans};font-size:14px;line-height:1.55;color:#6E6458;margin:4px 0 14px">Add a headshot and your details once, then apply to any role in a few taps.</div>
<a href="${profileUrl}" style="display:inline-block;font-family:${sans};font-size:14.5px;font-weight:700;color:#1A1A2E;border:1.5px solid #1A1A2E;border-radius:10px;padding:11px 20px;text-decoration:none">Create my free profile &#9656;</a>
</td></tr></table></td></tr>
</table>
</td></tr><tr><td>${csFooterA("You're getting this because this address was entered in the casting-calls box at castslate.com.", "#33826A", unsubUrl)}</td></tr></table></body></html>`;
}

async function sendResend(to: string, subject: string, html: string, unsubUrl: string) {
  if (!RESEND_API_KEY) return { ok: false, err: "RESEND_API_KEY not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], reply_to: CONTACT_EMAIL, subject, html,
      headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campaign", value: "newsletter_confirm" }] }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.ok) { const d = await r.json().catch(() => ({})); return { ok: true, id: d.id ?? null }; }
  return { ok: false, err: `${r.status} ${await r.text()}` };
}

async function unsubscribe(token: string): Promise<boolean> {
  const { data: s } = await sb.from("email_subscribers").select("id,email").eq("token", token).maybeSingle();
  if (!s) return false;
  const now = new Date().toISOString();
  await sb.from("email_subscribers").update({ status: "unsubscribed", unsubscribed_at: now }).eq("id", s.id);
  await sb.from("email_unsubscribes").upsert({ email: s.email, unsubscribed_at: now }, { onConflict: "email" });
  await sb.from("email_campaign_recipients").update({ status: "skipped_unsub" }).eq("email", s.email).eq("status", "queued");
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const url = new URL(req.url);
  const a = url.searchParams.get("a"), t = (url.searchParams.get("t") ?? "").trim();

  try {
    if (a === "unsub" && t) {
      await unsubscribe(t);
      return req.method === "POST" ? new Response("ok", { status: 200 }) : redirect(`${APP_URL}/unsubscribed`);
    }

    if (a === "confirm" && t) {
      const { data: s } = await sb.from("email_subscribers").select("id,email,status").eq("token", t).maybeSingle();
      if (!s) return redirect(`${APP_URL}/browse-castings`);
      if (s.status !== "confirmed") {
        await sb.from("email_subscribers").update({ status: "confirmed", confirmed_at: new Date().toISOString(), unsubscribed_at: null }).eq("id", s.id);
        // A fresh, explicit opt-in lifts an earlier manual unsubscribe — never a bounce or spam complaint.
        await sb.from("email_unsubscribes").delete().eq("email", s.email).is("reason", null);
        const { data: camps } = await sb.from("email_campaigns").select("id").eq("status", "sending");
        for (const c of camps ?? []) {
          const { error } = await sb.rpc("cs_add_subscribers_to_campaign", { p_campaign: c.id, p_email: s.email });
          if (error) console.error("[newsletter] add to campaign failed", c.id, error.message);
        }
      }
      return redirect(`${APP_URL}/browse-castings?subscribed=1`);
    }

    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    const body = await req.json().catch(() => ({}));
    const ok = () => json(req, { ok: true }); // identical answer whatever happened, so the list can't be probed

    if (String(body.hp ?? "").trim()) return ok();                       // honeypot filled → bot
    if (!(Number(body.ms) >= MIN_MS_ON_PAGE)) return ok();               // submitted too fast → bot
    const email = String(body.email ?? "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return json(req, { error: "invalid_email" }, 400);

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ipHash = ip ? await sha256(IP_SALT + ip) : null;
    if (ipHash) {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await sb.from("email_subscribers").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
      if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) return json(req, { error: "rate_limited" }, 429);
    }

    // Hard bounces / spam complaints are never mailed again.
    const { data: sup } = await sb.from("email_unsubscribes").select("reason").eq("email", email).maybeSingle();
    if (sup && (sup.reason === "bounce" || sup.reason === "complaint")) return ok();

    const { data: key } = await sb.rpc("cs_email_key", { addr: email });
    const emailKey = String(key || email);
    const { data: existing } = await sb.from("email_subscribers").select("id,status,token").eq("email_key", emailKey).maybeSingle();
    if (existing?.status === "confirmed") return ok();                   // already on the list, nothing to send

    let token = existing?.token as string | undefined;
    if (existing) {
      if (existing.status === "unsubscribed") { token = newToken(); }
      const { error } = await sb.from("email_subscribers").update({ status: "pending", token, ip_hash: ipHash ?? undefined }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      token = newToken();
      const { error } = await sb.from("email_subscribers").insert({ email, email_key: emailKey, status: "pending", token, ip_hash: ipHash, source: "footer" });
      if (error) throw new Error(error.message);
    }

    // At most one confirmation per address per day (shared ledger; null = ledger error → send nothing).
    const claimed = await claimSends(sb, "newsletter_confirm", [email], "24 hours");
    if (!claimed || !claimed.has(email)) return ok();

    const { data: castings } = await sb.rpc("get_campaign_castings", { n: 3, pinned: [] });
    const confirmUrl = `${FN_URL}?a=confirm&t=${token}`;
    const unsubUrl = `${FN_URL}?a=unsub&t=${token}`;
    const out = await sendResend(email, "Confirm your email to get casting calls", confirmEmail(email, confirmUrl, unsubUrl, castings ?? []), unsubUrl);
    if (!out.ok) {
      console.error("[newsletter] send failed", out.err);
      await releaseSends(sb, "newsletter_confirm", [email]);
      return json(req, { error: "send_failed" }, 502);
    }
    await sb.from("email_subscribers").update({ confirm_sent_at: new Date().toISOString() }).eq("email_key", emailKey);
    return ok();
  } catch (e) {
    console.error("[newsletter] error", e);
    return json(req, { error: "server_error" }, 500);
  }
});

// privacy-request — Supabase Edge Function
// Receives a "Your Privacy Choices" request from the public /privacy-choices page,
// verifies the Cloudflare Turnstile bot check, saves it to public.privacy_requests
// (service-role only table) and emails it to the office inbox.
//
// Secrets:
//   TURNSTILE_SECRET_KEY — Cloudflare Turnstile secret. Until it is set the function runs
//                          with Cloudflare's public TEST secret (accepts the test widget
//                          only) and every email is marked [TEST BOT CHECK].
//   RESEND_API_KEY, NOTIFY_FROM_EMAIL — same as contact-form.
// Optional:
//   PRIVACY_TO_EMAIL     — destination (falls back to CONTACT_TO_EMAIL, then team@castslate.com)
//   PRIVACY_IP_SALT      — salt for the hashed IP kept for rate limiting
//
// Deployed with verify_jwt:false: it is a public form; Turnstile + the honeypot, the
// time trap and a per-IP rate limit are the protection.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL        = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const TO_EMAIL          = Deno.env.get("PRIVACY_TO_EMAIL") ?? Deno.env.get("CONTACT_TO_EMAIL") ?? "team@castslate.com";
const TEST_SECRET       = "1x0000000000000000000000000000000AA"; // Cloudflare's documented always-pass test secret
const TURNSTILE_SECRET  = Deno.env.get("TURNSTILE_SECRET_KEY") ?? TEST_SECRET;
const TURNSTILE_TEST    = TURNSTILE_SECRET === TEST_SECRET;
const IP_SALT           = Deno.env.get("PRIVACY_IP_SALT") ?? "castslate-privacy";

// States whose privacy laws give these rights (matches the page's Residency Disclaimer).
const COVERED = new Set(["California","Colorado","Connecticut","Delaware","Indiana","Iowa","Kentucky","Oregon",
  "Maryland","Minnesota","Montana","Nebraska","New Hampshire","New Jersey","Rhode Island","Tennessee","Texas","Utah","Virginia"]);
const MAX_PER_IP_PER_HOUR = 5;

const ALLOWED_ORIGINS = ["https://www.castslate.com", "https://castslate.com"];
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const esc = (s: string) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const str = (v: unknown, max = 200) => (v ?? "").toString().trim().slice(0, max);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  // Cloudflare's test secret passes ANY token, so in test mode only accept the exact token
  // its test widget produces; random strings from scripts are still rejected.
  if (TURNSTILE_TEST && token !== "XXXX.DUMMY.TOKEN.XXXX") return false;
  const form = new FormData();
  form.append("secret", TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json();
    return d?.success === true;
  } catch (e) {
    console.error("[privacy-request] turnstile verify error:", e);
    return false;
  }
}

async function sendEmail(to: string, replyTo: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) return { ok: false, err: "RESEND_API_KEY not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], reply_to: replyTo, subject, html, text }),
  });
  return r.ok ? { ok: true, err: null } : { ok: false, err: await r.text() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, error: "method_not_allowed" });

  try {
    const b = await req.json().catch(() => ({}));

    // Bots: the honeypot must stay empty and a human needs at least 3 seconds.
    if (str(b.website)) return json(req, 200, { ok: true });
    const startedAt = Number(b.started_at) || 0;
    if (!startedAt || Date.now() - startedAt < 3000) return json(req, 400, { ok: false, error: "too_fast" });

    const state = str(b.state, 40);
    const requesterType = str(b.requester_type, 20);
    const firstName = str(b.first_name, 80), lastName = str(b.last_name, 80), email = str(b.email, 160).toLowerCase();
    const isAgent = requesterType === "agent";
    const cFirst = isAgent ? str(b.consumer_first_name, 80) : "";
    const cLast  = isAgent ? str(b.consumer_last_name, 80) : "";
    const cEmail = isAgent ? str(b.consumer_email, 160).toLowerCase() : "";
    const optOut = b.request_opt_out === true;
    const limitSpi = b.request_limit_spi === true && state === "California";
    const details = str(b.details, 2000);

    if (!COVERED.has(state)) return json(req, 400, { ok: false, error: "state_not_covered" });
    if (requesterType !== "consumer" && requesterType !== "agent") return json(req, 400, { ok: false, error: "invalid_requester" });
    if (!firstName || !lastName || !emailOk(email)) return json(req, 400, { ok: false, error: "invalid_contact" });
    if (isAgent && (!cFirst || !cLast || !emailOk(cEmail))) return json(req, 400, { ok: false, error: "invalid_consumer" });
    if (!optOut && !limitSpi) return json(req, 400, { ok: false, error: "no_request_selected" });

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (!(await verifyTurnstile(str(b.turnstile_token, 4096), ip))) return json(req, 400, { ok: false, error: "bot_check_failed" });

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const ipHash = ip ? await sha256(IP_SALT + ip) : null;
    if (ipHash) {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await sb.from("privacy_requests").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", since);
      if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) return json(req, 429, { ok: false, error: "rate_limited" });
    }

    const { data: row, error: insErr } = await sb.from("privacy_requests").insert({
      state, requester_type: requesterType, first_name: firstName, last_name: lastName, email,
      consumer_first_name: cFirst || null, consumer_last_name: cLast || null, consumer_email: cEmail || null,
      request_opt_out: optOut, request_limit_spi: limitSpi, details: details || null,
      ip_hash: ipHash, user_agent: str(req.headers.get("user-agent"), 300) || null,
    }).select("id, created_at").single();
    if (insErr || !row) {
      console.error("[privacy-request] insert error:", insErr);
      return json(req, 500, { ok: false, error: "save_failed" });
    }

    const asks = [optOut && "Opt out of the sale/sharing of personal information (incl. targeted advertising)",
                  limitSpi && "Limit use and disclosure of Sensitive Personal Information"].filter(Boolean) as string[];
    const who = `${firstName} ${lastName}`;
    const subject = `${TURNSTILE_TEST ? "[TEST BOT CHECK] " : ""}Privacy request (${state}): ${optOut ? "Opt out" : "Limit SPI"} — ${who}`;
    const rowsHtml = [
      ["Request ID", row.id], ["Received", new Date(row.created_at).toUTCString()], ["State", state],
      ["Submitted as", isAgent ? "Authorized representative of a consumer" : "Consumer"],
      ["Name", who], ["Email", email],
      ...(isAgent ? [["Consumer name", `${cFirst} ${cLast}`], ["Consumer email", cEmail]] : []),
    ].map(([k, v]) => `<tr><td style="padding:6px 0;color:#888;width:130px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(String(v))}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:560px;width:100%">
<tr><td style="background:#0E0C0B;padding:22px 28px"><div style="font-size:18px;font-weight:800;color:#F3EBE0">Your Privacy Choices — new request</div></td></tr>
<tr><td style="padding:26px 28px">
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#222">${rowsHtml}</table>
<div style="margin:18px 0 8px;color:#888;font-size:13px">Requested</div>
<ul style="margin:0 0 0 18px;padding:0;font-size:14px;color:#222;line-height:1.6">${asks.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
${details ? `<div style="margin:18px 0 8px;color:#888;font-size:13px">Details</div><div style="white-space:pre-wrap;line-height:1.6;font-size:14px;color:#222;background:#f7f7f8;border:1px solid #eee;border-radius:10px;padding:14px">${esc(details)}</div>` : ""}
<div style="margin-top:22px;padding-top:16px;border-top:1px solid #f0f0f0;font-size:12px;color:#888;line-height:1.6">
Saved in Supabase → table <b>privacy_requests</b> (status "new"). Opt-out requests must be honored as soon as feasibly possible (California: within 15 business days). Reply to this email to contact the requester.
${TURNSTILE_TEST ? "<br><b style='color:#b45309'>The bot check is in TEST mode: set TURNSTILE_SECRET_KEY before launch.</b>" : ""}
</div></td></tr></table></td></tr></table></body></html>`;
    const text = `New "Your Privacy Choices" request\n\nRequest ID: ${row.id}\nState: ${state}\nSubmitted as: ${isAgent ? "Authorized representative" : "Consumer"}\nName: ${who}\nEmail: ${email}\n` +
      (isAgent ? `Consumer: ${cFirst} ${cLast} <${cEmail}>\n` : "") + `\nRequested:\n- ${asks.join("\n- ")}\n` + (details ? `\nDetails:\n${details}\n` : "");

    const sent = await sendEmail(TO_EMAIL, email, subject, html, text);
    if (sent.ok) await sb.from("privacy_requests").update({ email_sent: true }).eq("id", row.id);
    else console.error("[privacy-request] email error (request is saved):", sent.err);

    return json(req, 200, { ok: true, id: row.id });
  } catch (e) {
    console.error("[privacy-request] error:", (e as Error)?.message || e);
    return json(req, 500, { ok: false, error: "server_error" });
  }
});

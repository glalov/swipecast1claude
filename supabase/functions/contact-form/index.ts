// contact-form — Supabase Edge Function
// Receives a submission from the public CastSlate contact form and emails it
// to the office inbox via Resend. No new contact form — this is just the wiring
// that turns a form submission into an email you receive.
//
// Reuses the SAME secrets already configured for notification/digest emails:
//   RESEND_API_KEY     — Resend API key
//   NOTIFY_FROM_EMAIL  — verified sender, e.g. "CastSlate <notifications@castslate.com>"
// Optional:
//   CONTACT_TO_EMAIL   — destination (defaults to officecasting01@gmail.com)

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL     = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const TO_EMAIL       = Deno.env.get("CONTACT_TO_EMAIL") ?? "team@castslate.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const name    = (body.name    ?? "").toString().trim();
    const email   = (body.email   ?? "").toString().trim();
    const role    = (body.role    ?? "").toString().trim();
    const subject = (body.subject ?? "").toString().trim();
    const message = (body.message ?? "").toString().trim();

    // Minimal validation — name, email, and message are required.
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!name || !emailOk || !message) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      console.error("[contact-form] RESEND_API_KEY not set");
      return new Response(JSON.stringify({ ok: false, error: "email_not_configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subjectLine = subject
      ? `CastSlate Contact: ${subject}`
      : `CastSlate Contact Form — message from ${name}`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;max-width:560px;width:100%">
      <tr><td style="background:#1B1C20;padding:22px 28px">
        <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.5px">CastSlate Contact Form</div>
      </td></tr>
      <tr><td style="padding:26px 28px">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#222">
          <tr><td style="padding:6px 0;color:#888;width:90px">Name</td><td style="padding:6px 0;font-weight:600">${esc(name)}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0;font-weight:600"><a href="mailto:${esc(email)}" style="color:#2563EB;text-decoration:none">${esc(email)}</a></td></tr>
          ${role ? `<tr><td style="padding:6px 0;color:#888">Role</td><td style="padding:6px 0">${esc(role)}</td></tr>` : ""}
          ${subject ? `<tr><td style="padding:6px 0;color:#888">Subject</td><td style="padding:6px 0">${esc(subject)}</td></tr>` : ""}
        </table>
        <div style="margin:18px 0 8px;color:#888;font-size:13px">Message</div>
        <div style="white-space:pre-wrap;line-height:1.6;font-size:14px;color:#222;background:#f7f7f8;border:1px solid #eee;border-radius:10px;padding:14px">${esc(message)}</div>
        <div style="margin-top:22px;padding-top:16px;border-top:1px solid #f0f0f0;font-size:12px;color:#aaa">
          Source: CastSlate Contact Form · Reply directly to this email to respond to ${esc(name)}.
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    const text =
      `New message from the CastSlate Contact Form\n\n` +
      `Name: ${name}\nEmail: ${email}\n` +
      (role ? `Role: ${role}\n` : "") +
      (subject ? `Subject: ${subject}\n` : "") +
      `\nMessage:\n${message}\n\nSource: CastSlate Contact Form`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: email,
        subject: subjectLine,
        html,
        text,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error("[contact-form] Resend error:", detail);
      return new Response(JSON.stringify({ ok: false, error: "send_failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[contact-form] error:", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: "server_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

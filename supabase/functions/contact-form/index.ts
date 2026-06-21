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

    if (!emailConfigured()) {
      console.error("[contact-form] email provider not configured");
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

    const sent = await sendEmail({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      replyTo: email,
      subject: subjectLine,
      html,
      text,
    });

    if (!sent.ok) {
      console.error("[contact-form] send error:", sent.err);
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

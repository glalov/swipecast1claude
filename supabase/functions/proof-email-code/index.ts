// proof-email-code — confirms a casting creator controls a company or school
// email address (2026-09-28, project verification on the Post New Casting form).
//
// POST (user JWT required, verify_jwt=true)
//   { action:"send",   email, kind:"company"|"school" } -> emails a 6-digit code
//   { action:"verify", email, code }                     -> { ok:true, id }
//
// The returned id is stored in the casting's proof list; the admin review screen
// looks it up in proof_email_codes (admin-only SELECT) to show "code confirmed".
// Codes are stored hashed, expire after 15 minutes, allow 5 tries, and each user
// can request at most 5 codes an hour.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL      = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const APP_URL         = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/, "");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL_RE  = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|hey)\.[a-z.]+$/i;
const SCHOOL    = /(\.edu|\.edu\.[a-z]{2}|\.ac\.[a-z]{2})$/i;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function codeEmail(code: string, kind: string): string {
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const what = kind === "school" ? "school" : "company";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F3EEE6;font-family:${sans}">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEE6;padding:36px 22px"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#FBF8F1;border-radius:16px;overflow:hidden;box-shadow:0 1px 0 #EAE2D1">
      <tr><td style="background:#1A1A2E;padding:22px 32px">
        <img src="${APP_URL}/logo-email-tile.png" width="30" height="30" alt="" style="display:inline-block;vertical-align:middle;border-radius:7px"/>
        <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:18px;font-weight:800;color:#FBF8F1">CastSlate</span>
      </td></tr>
      <tr><td style="padding:30px 32px 8px">
        <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#1A1A2E;line-height:1.2">Your confirmation code</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#5A5A72">Someone is posting a casting on CastSlate and entered this address to confirm their ${what}. If that's you, enter this code on the form:</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#1A1A2E;background:#F2ECE0;border-radius:12px;padding:16px 0;text-align:center">${code}</div>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#7A7064">The code works for 15 minutes. If you didn't ask for it, you can ignore this email and nothing will happen.</p>
      </td></tr>
      <tr><td style="padding:24px 32px 28px;font-size:11.5px;color:#A39684;border-top:1px solid #EAE2D1">&copy; ${new Date().getFullYear()} CastSlate &middot; <a href="mailto:team@castslate.com" style="color:#8A7A66;text-decoration:none">team@castslate.com</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return json({ error: "Unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body.email ?? "").trim().toLowerCase();

  if (body.action === "send") {
    const kind = body.kind === "school" ? "school" : "company";
    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (FREE_MAIL.test(email)) return json({ error: `That's a free email address, so it can't confirm a ${kind}. Pick another option instead.` }, 400);
    if (kind === "school" && !SCHOOL.test(email)) return json({ error: "That doesn't look like a school address. Try a student ID or enrollment letter instead." }, 400);

    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("proof_email_codes").select("id", { count: "exact", head: true })
      .eq("user_id", uid).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Too many codes requested. Please try again in an hour." }, 429);

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const id = crypto.randomUUID();
    const { error: insErr } = await admin.from("proof_email_codes").insert({
      id, user_id: uid, email, kind, code_hash: await sha256(id + ":" + code),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    if (insErr) return json({ error: "Could not create a code. Please try again." }, 500);

    if (!RESEND_API_KEY) return json({ error: "Email is not configured." }, 500);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: `${code} is your CastSlate confirmation code`, html: codeEmail(code, kind) }),
    });
    if (!r.ok) {
      await admin.from("proof_email_codes").delete().eq("id", id);
      return json({ error: "We couldn't send to that address. Check it and try again." }, 502);
    }
    return json({ ok: true });
  }

  if (body.action === "verify") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (!EMAIL_RE.test(email) || code.length !== 6) return json({ error: "Enter the 6-digit code." }, 400);
    const { data: row } = await admin.from("proof_email_codes").select("id,code_hash,attempts,expires_at,verified_at")
      .eq("user_id", uid).eq("email", email).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row) return json({ error: "Send a code first." }, 400);
    if (row.verified_at) return json({ ok: true, id: row.id });
    if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: "That code expired. Send a new one." }, 400);
    if (row.attempts >= 5) return json({ error: "Too many tries. Send a new code." }, 429);
    if (await sha256(row.id + ":" + code) !== row.code_hash) {
      await admin.from("proof_email_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return json({ error: "That code doesn't match. Check the email and try again." }, 400);
    }
    await admin.from("proof_email_codes").update({ verified_at: new Date().toISOString() }).eq("id", row.id);
    return json({ ok: true, id: row.id });
  }

  return json({ error: "Unknown action" }, 400);
});

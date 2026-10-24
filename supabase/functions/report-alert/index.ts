// report-alert — emails the team the moment someone files a report.
//
// Before this existed, a report from the Report button on a casting or profile was
// saved to public.reports and nothing else happened: no email, no alert. One report
// sat unread from 2026-08-07 until 2026-10-24. The Fair Casting & Inclusion page
// promises "We read every report", so every new report now reaches the inbox.
//
// Called by the reports_alert_after_insert trigger via pg_net:
//   POST { secret, report_id }
// verify_jwt=false; gated by app_secrets.report_alert_secret.
//
// Secrets: RESEND_API_KEY, NOTIFY_FROM_EMAIL (same as contact-form).
// Optional: REPORT_TO_EMAIL (falls back to CONTACT_TO_EMAIL, then team@castslate.com).
import { createClient } from "npm:@supabase/supabase-js@2";
import { claimSends, releaseSends } from "../_shared/send-guard.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const TO_EMAIL = Deno.env.get("REPORT_TO_EMAIL") ?? Deno.env.get("CONTACT_TO_EMAIL") ?? "team@castslate.com";
const SITE = "https://www.castslate.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const REASONS: Record<string, string> = {
  inappropriate: "Inappropriate / unsafe", scam: "Scam or fake casting", spam: "Spam / off-topic",
  impersonation: "Impersonation", underage: "Concerns about a minor", illegal: "Illegal activity", other: "Other",
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: "Bad request" }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: secretRow } = await admin.from("app_secrets").select("value").eq("key", "report_alert_secret").maybeSingle();
  if (!secretRow?.value || !body?.secret || body.secret !== secretRow.value) return json({ error: "Unauthorized" }, 401);

  const reportId = String(body.report_id ?? "");
  if (!reportId) return json({ error: "report_id required" }, 400);
  if (!RESEND_API_KEY) return json({ error: "Email not configured" }, 503);

  const { data: r, error } = await admin.from("reports")
    .select("id,reason,details,status,created_at,reporter_id,subject_profile_id,subject_casting_id")
    .eq("id", reportId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!r) return json({ error: "Report not found" }, 404);

  const ids = [r.reporter_id, r.subject_profile_id].filter(Boolean);
  const { data: people } = ids.length
    ? await admin.from("profiles").select("id,display_name,company_name,email,user_type").in("id", ids)
    : { data: [] as any[] };
  const byId = new Map((people ?? []).map((p: any) => [p.id, p]));
  const reporter: any = byId.get(r.reporter_id);
  const subjectProfile: any = r.subject_profile_id ? byId.get(r.subject_profile_id) : null;

  let subject = "Unknown";
  let subjectLink = "";
  if (r.subject_casting_id) {
    const { data: c } = await admin.from("castings").select("title,slug").eq("id", r.subject_casting_id).maybeSingle();
    subject = `Casting: ${c?.title ?? r.subject_casting_id}`;
    subjectLink = `${SITE}/casting/${encodeURIComponent(c?.slug || r.subject_casting_id)}`;
  } else if (subjectProfile) {
    const name = subjectProfile.display_name || subjectProfile.company_name || subjectProfile.email || r.subject_profile_id;
    subject = `Profile: ${name}${subjectProfile.user_type ? ` (${subjectProfile.user_type})` : ""}`;
  }
  const reporterName = reporter ? (reporter.display_name || reporter.email || r.reporter_id) : r.reporter_id;
  const reporterEmail = reporter?.email ?? "";

  // One alert per report, ever.
  const claimed = await claimSends(admin, "report_alert", [TO_EMAIL], "3650 days", r.id);
  if (claimed === null) return json({ error: "send guard unavailable" }, 503);
  if (!claimed.has(TO_EMAIL.toLowerCase())) return json({ ok: true, skipped: "send_guard_repeat" });

  const row = (k: string, v: string) =>
    `<tr><td style="padding:8px 0;color:#6B5F51;font-size:13px;width:110px;vertical-align:top">${k}</td><td style="padding:8px 0;color:#241F19;font-size:14px">${v}</td></tr>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#FAF6EE;padding:28px 16px">
  <div style="max-width:560px;margin:0 auto;background:#FFFDF8;border:1px solid #E4DCCB;border-radius:12px;padding:26px 28px">
    <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#9A3B2C;font-weight:700;margin-bottom:8px">New report</div>
    <h1 style="margin:0 0 18px;font-size:20px;color:#241F19">${esc(subject)}</h1>
    <table style="width:100%;border-collapse:collapse">
      ${row("Reason", esc(REASONS[r.reason] ?? r.reason ?? "Other"))}
      ${row("Reported by", esc(reporterName) + (reporterEmail ? ` &middot; <a href="mailto:${esc(reporterEmail)}" style="color:#206557">${esc(reporterEmail)}</a>` : ""))}
      ${row("Received", esc(new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })) + " ET")}
    </table>
    <div style="margin:18px 0 22px;padding:16px 18px;background:#F2ECE0;border-radius:10px;color:#241F19;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(r.details || "(no details)")}</div>
    <a href="${SITE}/admin#reports" style="display:inline-block;background:#2A8472;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:9px">Open in Admin &rarr; Reports</a>
    ${subjectLink ? `<a href="${subjectLink}" style="display:inline-block;margin-left:10px;color:#206557;font-size:14px">View the casting</a>` : ""}
    <p style="margin:22px 0 0;color:#6B5F51;font-size:12.5px;line-height:1.6">The person who was reported never sees the reporter's name. Reply to this email to contact the reporter.</p>
  </div></div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      ...(reporterEmail ? { reply_to: reporterEmail } : {}),
      subject: `New report: ${subject}`.slice(0, 180),
      html,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.id) {
    await releaseSends(admin, "report_alert", [TO_EMAIL], r.id);
    console.error("[report-alert] send failed:", res.status, JSON.stringify(out));
    return json({ error: "send failed", status: res.status }, 502);
  }
  return json({ ok: true, id: out.id });
});

// send-campaign — Supabase Edge Function (bulk email tool for CastSlate promo campaigns)
// Auth: `secret` === SUPABASE_SERVICE_ROLE_KEY or ADMIN_CAMPAIGN_SECRET, OR an admin user JWT.
// Public unsubscribe GET. Actions: create_campaign, import_recipients, list_campaigns,
// status, reset_campaign, requeue_failed, send_batch (+ test_email), provider_debug.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "cmpn_9e872b254fab6297129ac7ee95c021831a2163dd1f7a9906";
const DEFAULT_FROM         = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>";
const CONTACT_EMAIL        = Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com";
const APP_URL              = (Deno.env.get("APP_URL") ?? "https://www.castslate.com").replace(/\/$/,"");
const FN_BASE              = `${SUPABASE_URL}/functions/v1/send-campaign`;

const SENDER_API_KEY        = Deno.env.get("SENDER_API_KEY");
// Forced to Resend: the Sender.net/SES paths are dormant/unverified and silently drop
// mail (accept but never deliver). All campaign mail goes through Resend. A per-call
// `provider` override remains for testing. Revert this line to restore multi-provider.
const EMAIL_PROVIDER        = "resend";
const AWS_ACCESS_KEY_ID     = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const AWS_SES_REGION        = Deno.env.get("AWS_SES_REGION") ?? Deno.env.get("AWS_REGION") ?? "us-east-1";

function emailConfigured(): boolean {
  if (EMAIL_PROVIDER === "ses")    return !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);
  if (EMAIL_PROVIDER === "sender") return !!SENDER_API_KEY;
  return !!RESEND_API_KEY;
}

interface SendEmailArgs { from:string; to:string[]; subject:string; html:string; text?:string; replyTo?:string; headers?:Record<string,string>; }
interface SendEmailResult { ok:boolean; id:string|null; err:string|null; status:number; }

async function sendEmail(a: SendEmailArgs, providerOverride?: string): Promise<SendEmailResult> {
  const provider = (providerOverride ?? EMAIL_PROVIDER).toLowerCase();
  if (provider === "ses") {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) return { ok:false, id:null, err:"AWS SES credentials not set", status:500 };
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
      const r = await aws.fetch(`https://email.${AWS_SES_REGION}.amazonaws.com/v2/email/outbound-emails`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(payload) });
      if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.MessageId ?? null, err:null, status:r.status }; }
      return { ok:false, id:null, err:await r.text(), status:r.status };
    } catch (e) { return { ok:false, id:null, err:String(e), status:500 }; }
  }
  if (provider === "sender") {
    if (!SENDER_API_KEY) return { ok:false, id:null, err:"SENDER_API_KEY not set", status:500 };
    const parseAddr = (s:string) => { const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/); return m ? { email:m[2].trim(), name:(m[1].replace(/^"|"$/g,"").trim()||undefined) } : { email:s.trim() }; };
    // deno-lint-ignore no-explicit-any
    const sbody:any = { from:parseAddr(a.from), to:parseAddr(a.to[0]), subject:a.subject, html:a.html };
    if (a.text) sbody.text = a.text;
    const r = await fetch("https://api.sender.net/v2/message/send", { method:"POST", headers:{ Authorization:`Bearer ${SENDER_API_KEY}`, "Content-Type":"application/json", Accept:"application/json" }, body:JSON.stringify(sbody) });
    if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:(d.message_id ?? d.id ?? null), err:null, status:r.status }; }
    return { ok:false, id:null, err:await r.text(), status:r.status };
  }
  if (!RESEND_API_KEY) return { ok:false, id:null, err:"RESEND_API_KEY not set", status:500 };
  // deno-lint-ignore no-explicit-any
  const body:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
  if (a.text) body.text = a.text;
  if (a.replyTo) body.reply_to = a.replyTo;
  if (a.headers) body.headers = a.headers;
  const r = await fetch("https://api.resend.com/emails", { method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(body) });
  if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.id ?? null, err:null, status:r.status }; }
  return { ok:false, id:null, err:await r.text(), status:r.status };
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function b64urlEncode(s: string): string { return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64urlDecode(s: string): string { s = s.replace(/-/g,"+").replace(/_/g,"/"); while (s.length % 4) s += "="; return atob(s); }
function unsubUrl(email: string, campaignId: string): string { return `${FN_BASE}?action=unsubscribe&e=${encodeURIComponent(b64urlEncode(email))}&c=${encodeURIComponent(campaignId)}`; }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "unsubscribe" && url.searchParams.get("e")) {
      try {
        const email = b64urlDecode(url.searchParams.get("e")!).toLowerCase().trim();
        const campaignId = url.searchParams.get("c") || null;
        await sb.from("email_unsubscribes").upsert({ email, unsubscribed_at: new Date().toISOString(), campaign_id: campaignId }, { onConflict: "email" });
        await sb.from("email_campaign_recipients").update({ status: "skipped_unsub" }).eq("email", email).eq("status", "queued");
      } catch (e) { console.error("[send-campaign] unsubscribe error", e); }
      return new Response(null, { status: 302, headers: { "Location": `${APP_URL}/unsubscribed` } });
    }
    return new Response("Not found", { status: 404 });
  }

  const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const { action, secret } = body;

    let authorized = !!secret && (secret === SUPABASE_SERVICE_KEY || (ADMIN_SECRET && secret === ADMIN_SECRET));
    if (!authorized) {
      const authz = req.headers.get("Authorization") || "";
      if (authz.startsWith("Bearer ")) {
        try {
          const { data: { user } } = await sb.auth.getUser(authz.slice(7));
          if (user) { const { data: prof } = await sb.from("profiles").select("user_type").eq("id", user.id).maybeSingle(); if (prof && ["admin", "super_admin"].includes(prof.user_type)) authorized = true; }
        } catch (_) { /* fall through */ }
      }
    }
    if (!authorized) return res({ error: "Unauthorized" }, 401);

    if (action === "provider_debug") {
      return res({ resolved_provider: EMAIL_PROVIDER, bulk_env: Deno.env.get("BULK_EMAIL_PROVIDER") ?? null, email_env: Deno.env.get("EMAIL_PROVIDER") ?? null, configured: emailConfigured(), has_resend: !!RESEND_API_KEY, has_sender: !!SENDER_API_KEY, has_ses: !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) });
    }

    if (!emailConfigured()) return res({ error: "Email provider not configured" }, 500);

    if (action === "create_campaign") {
      const { name, subject, html, from_email, reply_to } = body;
      if (!name || !subject || !html) return res({ error: "name, subject, html required" }, 400);
      const { data, error } = await sb.from("email_campaigns").insert({ name, subject, html, from_email: from_email || DEFAULT_FROM, reply_to: reply_to || CONTACT_EMAIL, status: "draft" }).select("id").single();
      if (error) return res({ error: error.message }, 500);
      return res({ id: data.id });
    }

    if (action === "import_recipients") {
      const { campaign_id, recipients } = body;
      if (!campaign_id || !Array.isArray(recipients)) return res({ error: "campaign_id and recipients[] required" }, 400);
      const seen = new Set<string>(); const rows: { campaign_id: string; email: string; name: string | null }[] = []; let skipped = 0;
      for (const r of recipients) { const email = String(r.email ?? "").toLowerCase().trim(); if (!EMAIL_RE.test(email) || seen.has(email)) { skipped++; continue; } seen.add(email); rows.push({ campaign_id, email, name: (r.name ?? "").toString().trim() || null }); }
      const CH = 500;
      for (let i = 0; i < rows.length; i += CH) { const { error } = await sb.from("email_campaign_recipients").upsert(rows.slice(i, i + CH), { onConflict: "campaign_id,email", ignoreDuplicates: true }); if (error) return res({ error: error.message }, 500); }
      const { count } = await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id);
      await sb.from("email_campaigns").update({ total_recipients: count ?? rows.length, updated_at: new Date().toISOString() }).eq("id", campaign_id);
      return res({ imported: rows.length, skipped_invalid: skipped, total: count ?? rows.length });
    }

    if (action === "list_campaigns") {
      const { data: camps } = await sb.from("email_campaigns").select("id,name,subject,status,total_recipients,sent_count,failed_count,created_at").order("created_at", { ascending: false }).limit(30);
      const out = [];
      for (const c of camps || []) { const cnt = async (st: string) => (await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", st)).count ?? 0; const [queued, sent, failed, skipped] = await Promise.all([cnt("queued"), cnt("sent"), cnt("failed"), cnt("skipped_unsub")]); out.push({ ...c, queued, sent, failed, skipped }); }
      return res({ campaigns: out });
    }

    if (action === "status") {
      const { campaign_id } = body; if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      const cnt = async (status: string) => (await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", status)).count ?? 0;
      const [queued, sent, failed, skipped] = await Promise.all([cnt("queued"), cnt("sent"), cnt("failed"), cnt("skipped_unsub")]);
      return res({ queued, sent, failed, skipped, remaining: queued });
    }

    if (action === "reset_campaign") {
      const { campaign_id } = body; if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      await sb.from("email_campaign_recipients").update({ status: "queued", provider_message_id: null, error_message: null, sent_at: null }).eq("campaign_id", campaign_id).neq("status", "skipped_unsub");
      await sb.from("email_campaigns").update({ status: "draft", sent_count: 0, failed_count: 0, updated_at: new Date().toISOString() }).eq("id", campaign_id);
      const { count } = await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", "queued");
      return res({ ok: true, requeued: count ?? 0 });
    }

    if (action === "requeue_failed") {
      const { campaign_id } = body; if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      const { data: rows } = await sb.from("email_campaign_recipients").select("id,error_message").eq("campaign_id", campaign_id).eq("status", "failed");
      const ids = (rows || []).filter((r: any) => { const e = (r.error_message || "").toLowerCase(); return e.includes("429") || e.includes("rate_limit") || e.includes("too many requests") || e.includes("quota") || e.includes("throttl") || e.includes("sending rate"); }).map((r: any) => r.id);
      for (let i = 0; i < ids.length; i += 500) { await sb.from("email_campaign_recipients").update({ status: "queued", error_message: null }).in("id", ids.slice(i, i + 500)); }
      if (ids.length) await sb.from("email_campaigns").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", campaign_id);
      return res({ ok: true, requeued: ids.length });
    }

    if (action === "send_batch") {
      const { campaign_id } = body; if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      const { data: camp, error: ce } = await sb.from("email_campaigns").select("*").eq("id", campaign_id).single();
      if (ce || !camp) return res({ error: "Campaign not found" }, 404);
      const sendProvider = (body.provider ?? "").toString().toLowerCase() || undefined;
      const utmCampaign = ((camp.name || "campaign").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "campaign";
      const addUtm = (html: string) => html.replace(/href="(https?:\/\/(?:www\.)?castslate\.com[^"]*)"/gi, (_m: string, url: string) => { if (/[?&]utm_source=/i.test(url)) return `href="${url}"`; const sep = url.includes("?") ? "&" : "?"; return `href="${url}${sep}utm_source=email&utm_medium=campaign&utm_campaign=${encodeURIComponent(utmCampaign)}"`; });
      // First-name personalization: {{FIRST_NAME}} → recipient's first name, with a
      // friendly "there" fallback for blank or handle-style names (e.g. "user8").
      const firstNameOf = (name?: string | null) => { const first = (name ?? "").trim().split(/\s+/)[0] || ""; if (!first || /\d/.test(first) || first.length > 20) return "there"; return first.charAt(0).toUpperCase() + first.slice(1); };
      const buildHtml = (email: string, name?: string | null) => addUtm(camp.html).replaceAll("{{FIRST_NAME}}", firstNameOf(name)).replaceAll("{{UNSUB_URL}}", unsubUrl(email, campaign_id));
      const send = async (to: string, html: string) => { const out = await sendEmail({ from: camp.from_email, to: [to], replyTo: camp.reply_to || CONTACT_EMAIL, subject: camp.subject, html, headers: { "List-Unsubscribe": `<${unsubUrl(to, campaign_id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }, sendProvider); if (out.ok) return { ok: true, id: out.id as string }; return { ok: false, err: out.err ?? "", status: out.status }; };

      const testEmail = (body.test_email ?? "").toString().toLowerCase().trim();
      if (testEmail) {
        if (!EMAIL_RE.test(testEmail)) return res({ error: "invalid test_email" }, 400);
        const out = await send(testEmail, buildHtml(testEmail, body.test_name));
        return out.ok ? res({ ok: true, test: true, to: testEmail, provider_id: out.id, provider: sendProvider ?? EMAIL_PROVIDER }) : res({ ok: false, test: true, error: out.err, status: out.status, provider: sendProvider ?? EMAIL_PROVIDER }, 500);
      }

      const batchSize = Math.min(Math.max(parseInt(body.batch_size ?? "50", 10) || 50, 1), 100);
      const { data: recips } = await sb.from("email_campaign_recipients").select("id,email,name").eq("campaign_id", campaign_id).eq("status", "queued").limit(batchSize);
      if (!recips?.length) { await sb.from("email_campaigns").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", campaign_id); return res({ sent: 0, failed: 0, skipped: 0, remaining: 0, done: true }); }
      await sb.from("email_campaigns").update({ status: "sending" }).eq("id", campaign_id);
      const emails = recips.map((r: any) => r.email);
      const { data: unsubs } = await sb.from("email_unsubscribes").select("email").in("email", emails);
      const unsubSet = new Set((unsubs || []).map((u: any) => u.email));
      const started = Date.now(); const TIME_BUDGET_MS = 110_000;
      let sent = 0, failed = 0, skipped = 0, deferred = 0, quotaHit = false, timedOut = false; let rateLimitStreak = 0;
      for (const r of recips) {
        if (Date.now() - started > TIME_BUDGET_MS) { timedOut = true; break; }
        if (unsubSet.has(r.email)) { await sb.from("email_campaign_recipients").update({ status: "skipped_unsub" }).eq("id", r.id); skipped++; continue; }
        const out = await send(r.email, buildHtml(r.email, r.name));
        if (out.ok) { await sb.from("email_campaign_recipients").update({ status: "sent", provider_message_id: out.id, sent_at: new Date().toISOString(), error_message: null }).eq("id", r.id); sent++; rateLimitStreak = 0; }
        else {
          const e = (out.err || "").toLowerCase();
          const temporary = out.status === 429 || e.includes("rate_limit") || e.includes("rate limit") || e.includes("too many requests") || e.includes("quota") || e.includes("throttl") || e.includes("sending rate");
          if (temporary) { deferred++; rateLimitStreak++; if (e.includes("quota") || e.includes("daily") || rateLimitStreak >= 3) { quotaHit = true; break; } await new Promise((res2) => setTimeout(res2, 1000)); continue; }
          await sb.from("email_campaign_recipients").update({ status: "failed", error_message: out.err }).eq("id", r.id); failed++; rateLimitStreak = 0;
        }
        await new Promise((res2) => setTimeout(res2, 250));
      }
      const cnt = async (status: string) => (await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", status)).count ?? 0;
      const [totalSent, totalFailed, remaining] = await Promise.all([cnt("sent"), cnt("failed"), cnt("queued")]);
      await sb.from("email_campaigns").update({ sent_count: totalSent, failed_count: totalFailed, status: remaining === 0 ? "sent" : "sending", updated_at: new Date().toISOString() }).eq("id", campaign_id);
      return res({ sent, failed, skipped, deferred, quota_hit: quotaHit, timed_out: timedOut, remaining });
    }

    return res({ error: "Unknown action" }, 400);
  } catch (e) { console.error("[send-campaign]", e); return res({ error: String(e) }, 500); }
});

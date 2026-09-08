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

// A provider call with no timeout can hang past the 150s edge-function wall clock. When
// that happened the gateway returned 504 to the admin UI *while the isolate kept sending*,
// so the operator saw a hard error on a batch that was still in flight. Every provider
// call now aborts at 20s, and send_batch keeps enough headroom to always return cleanly.
const SEND_TIMEOUT_MS = 20_000;
const fetchT = (url: string, init: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });

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
      const r = await aws.fetch(`https://email.${AWS_SES_REGION}.amazonaws.com/v2/email/outbound-emails`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(payload), signal:AbortSignal.timeout(SEND_TIMEOUT_MS) });
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
    try {
      const r = await fetchT("https://api.sender.net/v2/message/send", { method:"POST", headers:{ Authorization:`Bearer ${SENDER_API_KEY}`, "Content-Type":"application/json", Accept:"application/json" }, body:JSON.stringify(sbody) });
      if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:(d.message_id ?? d.id ?? null), err:null, status:r.status }; }
      return { ok:false, id:null, err:await r.text(), status:r.status };
    } catch (e) { return { ok:false, id:null, err:`provider_timeout after ${SEND_TIMEOUT_MS}ms — delivery uncertain: ${String(e)}`, status:504 }; }
  }
  if (!RESEND_API_KEY) return { ok:false, id:null, err:"RESEND_API_KEY not set", status:500 };
  // deno-lint-ignore no-explicit-any
  const body:any = { from:a.from, to:a.to, subject:a.subject, html:a.html };
  if (a.text) body.text = a.text;
  if (a.replyTo) body.reply_to = a.replyTo;
  if (a.headers) body.headers = a.headers;
  try {
    const r = await fetchT("https://api.resend.com/emails", { method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(body) });
    if (r.ok) { const d = await r.json().catch(()=>({})); return { ok:true, id:d.id ?? null, err:null, status:r.status }; }
    return { ok:false, id:null, err:await r.text(), status:r.status };
  } catch (e) {
    // Aborted or network-dropped: Resend may or may not have accepted it. Reported as a
    // hard failure on purpose — requeueing a maybe-sent address would double-mail someone.
    return { ok:false, id:null, err:`provider_timeout after ${SEND_TIMEOUT_MS}ms — delivery uncertain: ${String(e)}`, status:504 };
  }
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function b64urlEncode(s: string): string { return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64urlDecode(s: string): string { s = s.replace(/-/g,"+").replace(/_/g,"/"); while (s.length % 4) s += "="; return atob(s); }
function unsubUrl(email: string, campaignId: string): string { return `${FN_BASE}?action=unsubscribe&e=${encodeURIComponent(b64urlEncode(email))}&c=${encodeURIComponent(campaignId)}`; }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Unsubscribe — handle BOTH the visible in-email link (GET) and the native
  // one-click button Gmail/Apple Mail render from List-Unsubscribe-Post (RFC 8058:
  // a POST with body "List-Unsubscribe=One-Click", not JSON). Both carry
  // ?action=unsubscribe&e=<email>&c=<campaign> in the URL; must run before req.json().
  {
    const url = new URL(req.url);
    if ((req.method === "GET" || req.method === "POST") && url.searchParams.get("action") === "unsubscribe" && url.searchParams.get("e")) {
      try {
        const email = b64urlDecode(url.searchParams.get("e")!).toLowerCase().trim();
        const campaignId = url.searchParams.get("c") || null;
        await sb.from("email_unsubscribes").upsert({ email, unsubscribed_at: new Date().toISOString(), campaign_id: campaignId }, { onConflict: "email" });
        await sb.from("email_campaign_recipients").update({ status: "skipped_unsub" }).eq("email", email).eq("status", "queued");
      } catch (e) { console.error("[send-campaign] unsubscribe error", e); }
      return req.method === "GET"
        ? new Response(null, { status: 302, headers: { ...cors, "Location": `${APP_URL}/unsubscribed` } })
        : new Response(JSON.stringify({ ok: true, unsubscribed: true }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (req.method === "GET") return new Response("Not found", { status: 404 });
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

    // Swap the design (or subject) on a campaign that already has its list
    // attached — a casting can expire halfway through a send, and re-uploading
    // an 11K CSV just to fix the HTML would re-queue people already emailed.
    // Recipients are untouched: only the still-queued rows pick up the new HTML,
    // because send_batch reads camp.html fresh on every batch.
    if (action === "update_campaign") {
      const { campaign_id, name, subject, html, from_email, reply_to } = body;
      if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof name === "string" && name.trim()) patch.name = name;
      if (typeof subject === "string" && subject.trim()) patch.subject = subject;
      if (typeof html === "string" && html.trim()) {
        // An email without the unsubscribe tag is not sendable — refuse rather
        // than let a campaign go out that cannot be opted out of.
        if (!html.includes("{{UNSUB_URL}}")) return res({ error: "html is missing {{UNSUB_URL}} — refusing to save" }, 400);
        patch.html = html;
      }
      if (typeof from_email === "string" && from_email.trim()) patch.from_email = from_email;
      if (typeof reply_to === "string" && reply_to.trim()) patch.reply_to = reply_to;
      if (Object.keys(patch).length === 1) return res({ error: "nothing to update" }, 400);
      const { error } = await sb.from("email_campaigns").update(patch).eq("id", campaign_id);
      if (error) return res({ error: error.message }, 500);
      const { count } = await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", "queued");
      return res({ ok: true, updated: Object.keys(patch).filter((k) => k !== "updated_at"), still_queued: count ?? 0 });
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
      for (const c of camps || []) { const cnt = async (st: string) => (await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", st)).count ?? 0; const [queued, sent, failed, skipped, skippedIsUser] = await Promise.all([cnt("queued"), cnt("sent"), cnt("failed"), cnt("skipped_unsub"), cnt("skipped_is_user")]); out.push({ ...c, queued, sent, failed, skipped, skipped_is_user: skippedIsUser }); }
      return res({ campaigns: out });
    }

    if (action === "status") {
      const { campaign_id } = body; if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      const cnt = async (status: string) => (await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", status)).count ?? 0;
      const [queued, sent, failed, skipped, skippedIsUser] = await Promise.all([cnt("queued"), cnt("sent"), cnt("failed"), cnt("skipped_unsub"), cnt("skipped_is_user")]);
      return res({ queued, sent, failed, skipped, skipped_is_user: skippedIsUser, remaining: queued });
    }

    if (action === "reset_campaign") {
      const { campaign_id } = body; if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      // Never resurrect an unsubscribe, a registered user, or a known-bad address.
      await sb.from("email_campaign_recipients").update({ status: "queued", provider_message_id: null, error_message: null, sent_at: null }).eq("campaign_id", campaign_id).not("status", "in", "(skipped_unsub,skipped_is_user,skipped_invalid)");
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

      // ── {{CASTINGS}} — live listings, resolved once per batch ──────────────
      // A campaign's HTML is written weeks before it finishes sending, so any
      // casting hardcoded into it is guaranteed to expire mid-list. The template
      // instead carries {{CASTINGS}} — optionally {{CASTINGS:slug}} to pin one
      // while it lasts — and it is filled here from the DB, so every batch, and
      // every test send, mails whatever is genuinely open right now. When a
      // listing expires it drops out of the RPC and the next newest takes its
      // place with no edit to the campaign.
      const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const money = (n: number) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
      const rateLine = (lo: number | null, hi: number | null, unit: string | null) => {
        if (lo == null || hi == null) return "";
        const sfx = unit === "flat" ? " flat" : unit === "week" ? "/week" : unit === "hour" ? "/hour" : "/day";
        return (Number(lo) === Number(hi) ? money(lo) : `${money(lo)}&ndash;${money(hi)}`) + sfx;
      };
      const listingHtml = (c: any) => {
        const url = `${APP_URL}/casting/${encodeURIComponent(c.slug)}`;
        const eyebrow = [c.ctype, /not applicable/i.test(c.union_status || "") ? "" : c.union_status, "Paid"]
          .filter(Boolean).map(esc).join(" &bull; ");
        const roles = c.role_count === 1 ? "1 role" : `${c.role_count} roles`;
        const ages = (c.age_lo != null && c.age_hi != null && c.age_hi > c.age_lo) ? `, ages ${c.age_lo}&ndash;${c.age_hi}` : "";
        const where = c.location ? `${esc(c.location)} &mdash; ` : "";
        const meta = `${where}${roles}${ages}.`.trim();
        const pay = rateLine(c.rate_lo, c.rate_hi, c.rate_unit);
        // Not every casting has a still, and several never will. Rather than
        // invent one or leave a broken frame, an imageless listing gets a black
        // tile with the casting type set in white — automatic for every future
        // casting posted without an image.
        const thumb = c.image_url
          ? `<img src="${esc(c.image_url)}" width="140" alt="${esc(c.title)}" style="display:block;width:140px;height:96px;object-fit:cover;border:none;outline:none;" />`
          : `<table width="140" cellpadding="0" cellspacing="0" role="presentation" style="width:140px;height:96px;background:#101014;"><tr><td style="height:96px;text-align:center;vertical-align:middle;padding:0 8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#ffffff;line-height:1.45;">${esc(c.ctype || "Casting")}</td></tr></table>`;
        // Pay gets its own line: it is the thing being scanned for, and at
        // #5c564a inside the run-on meta line it was the quietest text in the
        // email. Icon is a PNG, not inline SVG — Gmail strips SVG entirely.
        const payLine = pay
          ? `\n        <div style="margin-top:7px;font-family:Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:800;color:#0F6B33;line-height:1.5;"><img src="${APP_URL}/email/money-icon.png" width="20" height="20" alt="" style="display:inline-block;width:20px;height:20px;vertical-align:-5px;margin-right:7px;border:none;outline:none;" />${pay}</div>`
          : "";
        return `  <tr><td class="pad" style="padding:14px 24px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td class="thumb" width="140" style="vertical-align:top;padding-right:14px;line-height:0;">${thumb}</td>
      <td style="vertical-align:top;">
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#0F6B66;margin-bottom:4px;">${eyebrow}</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;color:#101014;line-height:1.25;margin-bottom:5px;">${esc(c.title)}</div>
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:12.5px;color:#332e24;line-height:1.6;">${meta}</div>${payLine}
        <a href="${url}" style="display:inline-block;margin-top:8px;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;font-weight:800;color:#3a35c9;text-decoration:underline;">See the roles &rarr;</a>
      </td>
    </tr></table>
  </td></tr>`;
      };
      const CASTINGS_TAG = /\{\{CASTINGS(?::([a-z0-9-]+))?\}\}/i;
      let castingsBlock: string | null = null;
      const tagMatch = (camp.html || "").match(CASTINGS_TAG);
      if (tagMatch) {
        const pinned = tagMatch[1] ? [tagMatch[1]] : [];
        const { data: live, error: le } = await sb.rpc("get_campaign_castings", { n: 3, pinned });
        const rows = (live || []) as any[];
        // Refuse rather than mail an empty "Open this week" section.
        if (le || !rows.length) return res({ error: le ? `castings lookup failed: ${le.message}` : "no live castings to feature — refusing to send" }, 500);
        const rule = `  <tr><td class="pad" style="padding:14px 24px 0;"><div style="height:1px;background:#e2ddd0;"></div></td></tr>`;
        castingsBlock = rows.map(listingHtml).join("\n" + rule + "\n") + "\n";
      }
      const withCastings = (html: string) => castingsBlock == null ? html : html.replace(CASTINGS_TAG, castingsBlock);

      // withCastings first, then addUtm — the injected listing links have to be
      // in the HTML before the UTM pass runs or they go out untagged.
      const buildHtml = (email: string, name?: string | null) => addUtm(withCastings(camp.html)).replaceAll("{{FIRST_NAME}}", firstNameOf(name)).replaceAll("{{UNSUB_URL}}", unsubUrl(email, campaign_id));
      const send = async (to: string, html: string) => { const out = await sendEmail({ from: camp.from_email, to: [to], replyTo: camp.reply_to || CONTACT_EMAIL, subject: camp.subject, html, headers: { "List-Unsubscribe": `<${unsubUrl(to, campaign_id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }, sendProvider); if (out.ok) return { ok: true, id: out.id as string }; return { ok: false, err: out.err ?? "", status: out.status }; };

      const testEmail = (body.test_email ?? "").toString().toLowerCase().trim();
      if (testEmail) {
        if (!EMAIL_RE.test(testEmail)) return res({ error: "invalid test_email" }, 400);
        const out = await send(testEmail, buildHtml(testEmail, body.test_name));
        return out.ok ? res({ ok: true, test: true, to: testEmail, provider_id: out.id, provider: sendProvider ?? EMAIL_PROVIDER }) : res({ ok: false, test: true, error: out.err, status: out.status, provider: sendProvider ?? EMAIL_PROVIDER }, 500);
      }

      const batchSize = Math.min(Math.max(parseInt(body.batch_size ?? "50", 10) || 50, 1), 100);
      const { data: recips } = await sb.from("email_campaign_recipients").select("id,email,name").eq("campaign_id", campaign_id).eq("status", "queued").order("created_at", { ascending: true }).limit(batchSize);
      if (!recips?.length) { await sb.from("email_campaigns").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", campaign_id); return res({ sent: 0, failed: 0, skipped: 0, remaining: 0, done: true }); }
      await sb.from("email_campaigns").update({ status: "sending" }).eq("id", campaign_id);
      const emails = recips.map((r: any) => r.email);
      const { data: unsubs } = await sb.from("email_unsubscribes").select("email").in("email", emails);
      const unsubSet = new Set((unsubs || []).map((u: any) => u.email));
      // Cold-list campaigns skip anyone who has since become a CastSlate user, free
      // or premium. A DB trigger already pulls them out of the queue at signup; this
      // is the backstop for rows requeued by hand or a signup mid-run.
      let memberSet = new Set<string>();
      if (camp.exclude_registered_users !== false) {
        const { data: mem, error: me } = await sb.rpc("cs_campaign_member_emails", { addrs: emails });
        // Fail closed: a broken filter must not turn into a blast at paying members.
        if (me) return res({ error: `member filter failed, batch not sent: ${me.message}` }, 500);
        memberSet = new Set(((mem as string[]) || []).map((e) => e.toLowerCase()));
      }
      // Budget + per-send timeout must both fit inside the 150s edge-function wall clock:
      // 85s of loop, plus at most one 20s send in flight, plus the tallies = ~110s worst
      // case. Anything left over is reported as remaining and picked up by the next batch.
      const started = Date.now(); const TIME_BUDGET_MS = 85_000;
      let sent = 0, failed = 0, skipped = 0, skippedMember = 0, deferred = 0, quotaHit = false, timedOut = false; let rateLimitStreak = 0;
      for (const r of recips) {
        if (Date.now() - started > TIME_BUDGET_MS) { timedOut = true; break; }
        if (unsubSet.has(r.email)) { await sb.from("email_campaign_recipients").update({ status: "skipped_unsub" }).eq("id", r.id); skipped++; continue; }
        if (memberSet.has(r.email)) { await sb.from("email_campaign_recipients").update({ status: "skipped_is_user" }).eq("id", r.id); skippedMember++; continue; }
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
      return res({ sent, failed, skipped, skipped_is_user: skippedMember, deferred, quota_hit: quotaHit, timed_out: timedOut, remaining });
    }

    return res({ error: "Unknown action" }, 400);
  } catch (e) { console.error("[send-campaign]", e); return res({ error: String(e) }, 500); }
});

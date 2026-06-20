// send-campaign — Supabase Edge Function
// Admin bulk email tool for CastSlate promo campaigns.
//
// Auth (any ONE of):
//   • `secret` === SUPABASE_SERVICE_ROLE_KEY or ADMIN_CAMPAIGN_SECRET  (standalone local tool)
//   • Authorization: Bearer <user JWT> where that user's profile is admin/super_admin (in-app admin UI)
// The unsubscribe GET endpoint is public (link inside emails).
//
// Actions: create_campaign, import_recipients, list_campaigns, status, send_batch (+ test_email)

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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64urlDecode(s: string): string {
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  while (s.length % 4) s += "=";
  return atob(s);
}
function unsubUrl(email: string, campaignId: string): string {
  return `${FN_BASE}?action=unsubscribe&e=${encodeURIComponent(b64urlEncode(email))}&c=${encodeURIComponent(campaignId)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Public unsubscribe (GET link from inside emails)
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "unsubscribe" && url.searchParams.get("e")) {
      try {
        const email = b64urlDecode(url.searchParams.get("e")!).toLowerCase().trim();
        const campaignId = url.searchParams.get("c") || null;
        await sb.from("email_unsubscribes").upsert(
          { email, unsubscribed_at: new Date().toISOString(), campaign_id: campaignId },
          { onConflict: "email" }
        );
        await sb.from("email_campaign_recipients").update({ status: "skipped_unsub" }).eq("email", email).eq("status", "queued");
      } catch (e) { console.error("[send-campaign] unsubscribe error", e); }
      return new Response(null, { status: 302, headers: { "Location": `${APP_URL}/unsubscribed` } });
    }
    return new Response("Not found", { status: 404 });
  }

  const res = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const { action, secret } = body;

    // ── Auth: shared secret OR an admin's logged-in session ──────────────────
    let authorized = !!secret && (secret === SUPABASE_SERVICE_KEY || (ADMIN_SECRET && secret === ADMIN_SECRET));
    if (!authorized) {
      const authz = req.headers.get("Authorization") || "";
      if (authz.startsWith("Bearer ")) {
        try {
          const { data: { user } } = await sb.auth.getUser(authz.slice(7));
          if (user) {
            const { data: prof } = await sb.from("profiles").select("user_type").eq("id", user.id).maybeSingle();
            if (prof && ["admin", "super_admin"].includes(prof.user_type)) authorized = true;
          }
        } catch (_) { /* fall through to 401 */ }
      }
    }
    if (!authorized) return res({ error: "Unauthorized" }, 401);
    if (!RESEND_API_KEY) return res({ error: "RESEND_API_KEY not set" }, 500);

    if (action === "create_campaign") {
      const { name, subject, html, from_email, reply_to } = body;
      if (!name || !subject || !html) return res({ error: "name, subject, html required" }, 400);
      const { data, error } = await sb.from("email_campaigns").insert({
        name, subject, html,
        from_email: from_email || DEFAULT_FROM,
        reply_to: reply_to || CONTACT_EMAIL,
        status: "draft",
      }).select("id").single();
      if (error) return res({ error: error.message }, 500);
      return res({ id: data.id });
    }

    if (action === "import_recipients") {
      const { campaign_id, recipients } = body;
      if (!campaign_id || !Array.isArray(recipients)) return res({ error: "campaign_id and recipients[] required" }, 400);
      const seen = new Set<string>();
      const rows: { campaign_id: string; email: string; name: string | null }[] = [];
      let skipped = 0;
      for (const r of recipients) {
        const email = String(r.email ?? "").toLowerCase().trim();
        if (!EMAIL_RE.test(email) || seen.has(email)) { skipped++; continue; }
        seen.add(email);
        rows.push({ campaign_id, email, name: (r.name ?? "").toString().trim() || null });
      }
      const CH = 500;
      for (let i = 0; i < rows.length; i += CH) {
        const { error } = await sb.from("email_campaign_recipients")
          .upsert(rows.slice(i, i + CH), { onConflict: "campaign_id,email", ignoreDuplicates: true });
        if (error) return res({ error: error.message }, 500);
      }
      const { count } = await sb.from("email_campaign_recipients")
        .select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id);
      await sb.from("email_campaigns").update({ total_recipients: count ?? rows.length, updated_at: new Date().toISOString() }).eq("id", campaign_id);
      return res({ imported: rows.length, skipped_invalid: skipped, total: count ?? rows.length });
    }

    if (action === "list_campaigns") {
      const { data: camps } = await sb.from("email_campaigns")
        .select("id,name,subject,status,total_recipients,sent_count,failed_count,created_at")
        .order("created_at", { ascending: false }).limit(30);
      const out = [];
      for (const c of camps || []) {
        const cnt = async (st: string) => (await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", st)).count ?? 0;
        const [queued, sent, failed, skipped] = await Promise.all([cnt("queued"), cnt("sent"), cnt("failed"), cnt("skipped_unsub")]);
        out.push({ ...c, queued, sent, failed, skipped });
      }
      return res({ campaigns: out });
    }

    if (action === "status") {
      const { campaign_id } = body;
      if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      const cnt = async (status: string) => (await sb.from("email_campaign_recipients")
        .select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", status)).count ?? 0;
      const [queued, sent, failed, skipped] = await Promise.all([cnt("queued"), cnt("sent"), cnt("failed"), cnt("skipped_unsub")]);
      return res({ queued, sent, failed, skipped, remaining: queued });
    }

    if (action === "send_batch") {
      const { campaign_id } = body;
      if (!campaign_id) return res({ error: "campaign_id required" }, 400);
      const { data: camp, error: ce } = await sb.from("email_campaigns").select("*").eq("id", campaign_id).single();
      if (ce || !camp) return res({ error: "Campaign not found" }, 404);

      const buildHtml = (email: string) => camp.html.replaceAll("{{UNSUB_URL}}", unsubUrl(email, campaign_id));
      const send = async (to: string, html: string) => {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: camp.from_email, to: [to], reply_to: camp.reply_to || CONTACT_EMAIL,
            subject: camp.subject, html,
            headers: { "List-Unsubscribe": `<${unsubUrl(to, campaign_id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          }),
        });
        if (r.ok) { const d = await r.json(); return { ok: true, id: d.id as string }; }
        return { ok: false, err: await r.text() };
      };

      const testEmail = (body.test_email ?? "").toString().toLowerCase().trim();
      if (testEmail) {
        if (!EMAIL_RE.test(testEmail)) return res({ error: "invalid test_email" }, 400);
        const out = await send(testEmail, buildHtml(testEmail));
        return out.ok ? res({ ok: true, test: true, to: testEmail, provider_id: out.id })
                      : res({ ok: false, test: true, error: out.err }, 500);
      }

      const batchSize = Math.min(Math.max(parseInt(body.batch_size ?? "50", 10) || 50, 1), 100);
      const { data: recips } = await sb.from("email_campaign_recipients")
        .select("id,email").eq("campaign_id", campaign_id).eq("status", "queued").limit(batchSize);
      if (!recips?.length) {
        await sb.from("email_campaigns").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", campaign_id);
        return res({ sent: 0, failed: 0, skipped: 0, remaining: 0, done: true });
      }
      await sb.from("email_campaigns").update({ status: "sending" }).eq("id", campaign_id);

      const emails = recips.map((r: any) => r.email);
      const { data: unsubs } = await sb.from("email_unsubscribes").select("email").in("email", emails);
      const unsubSet = new Set((unsubs || []).map((u: any) => u.email));

      let sent = 0, failed = 0, skipped = 0;
      for (const r of recips) {
        if (unsubSet.has(r.email)) {
          await sb.from("email_campaign_recipients").update({ status: "skipped_unsub" }).eq("id", r.id);
          skipped++; continue;
        }
        const out = await send(r.email, buildHtml(r.email));
        if (out.ok) {
          await sb.from("email_campaign_recipients").update({ status: "sent", provider_message_id: out.id, sent_at: new Date().toISOString(), error_message: null }).eq("id", r.id);
          sent++;
        } else {
          await sb.from("email_campaign_recipients").update({ status: "failed", error_message: out.err }).eq("id", r.id);
          failed++;
        }
        await new Promise((res2) => setTimeout(res2, 120));
      }

      const cnt = async (status: string) => (await sb.from("email_campaign_recipients")
        .select("*", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", status)).count ?? 0;
      const [totalSent, totalFailed, remaining] = await Promise.all([cnt("sent"), cnt("failed"), cnt("queued")]);
      await sb.from("email_campaigns").update({ sent_count: totalSent, failed_count: totalFailed, status: remaining === 0 ? "sent" : "sending", updated_at: new Date().toISOString() }).eq("id", campaign_id);
      return res({ sent, failed, skipped, remaining });
    }

    return res({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[send-campaign]", e);
    return res({ error: String(e) }, 500);
  }
});

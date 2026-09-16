// resend-webhook — Supabase Edge Function
// Receives Resend webhook events and auto-suppresses bounced / spam-complained
// addresses so they are never emailed again (campaigns, digest, transactional).
//
// Setup:
//   1. Supabase secret RESEND_WEBHOOK_SECRET = the signing secret Resend shows
//      when you create the webhook (starts with "whsec_").
//   2. In the Resend dashboard, add a webhook pointing at this function URL and
//      subscribe to at least: email.bounced, email.complained,
//      email.opened, email.clicked  (the last two also need Open/Click
//      tracking switched on for the domain, or they are never emitted).
//
// Opens and clicks are recorded, not suppressed: they feed public.email_engagement,
// which is what decides how often the premium upsell mails each person. Before
// this the campaign had no idea who read it and mailed everyone twice a day.
//
// Signature is verified (Svix scheme) when RESEND_WEBHOOK_SECRET is set. If the
// secret is absent the event is still processed but logged as UNVERIFIED, so the
// endpoint works the moment you paste the URL and hardens once you add the secret.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET       = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, svix-id, svix-timestamp, svix-signature",
};

// Verify a Svix-signed webhook (the scheme Resend uses).
async function verifySignature(secret: string, headers: Headers, payload: string): Promise<boolean> {
  const svixId = headers.get("svix-id");
  const svixTs = headers.get("svix-timestamp");
  const svixSig = headers.get("svix-signature");
  if (!svixId || !svixTs || !svixSig) return false;
  try {
    const secretBytes = decodeBase64(secret.replace(/^whsec_/, ""));
    const signedContent = `${svixId}.${svixTs}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
    const expected = encodeBase64(new Uint8Array(mac));
    // Header is a space-separated list of "v1,<signature>" entries.
    return svixSig.split(" ").some((part) => {
      const comma = part.indexOf(",");
      const sig = comma >= 0 ? part.slice(comma + 1) : part;
      return sig === expected;
    });
  } catch (e) {
    console.error("[resend-webhook] signature verify error", e);
    return false;
  }
}

function extractEmails(data: unknown): string[] {
  // deno-lint-ignore no-explicit-any
  const d = (data ?? {}) as any;
  const raw = d.to ?? d.email ?? d.recipient ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((x: unknown) => String(x ?? "").trim().toLowerCase())
    .filter((e: string) => e.includes("@"));
}

// Tags travel with the send (premium-upsell sets campaign + slot + uid) and come
// back on every event. Resend has shipped them both as an array of {name,value}
// and as a flat object, so accept either rather than silently losing the slot.
function readTags(data: unknown): Record<string, string> {
  // deno-lint-ignore no-explicit-any
  const raw = ((data ?? {}) as any).tags;
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const t of raw) {
      const n = String(t?.name ?? "").trim();
      if (n) out[n] = String(t?.value ?? "");
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = String(v ?? "");
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const payload = await req.text();

  if (WEBHOOK_SECRET) {
    const ok = await verifySignature(WEBHOOK_SECRET, req.headers, payload);
    if (!ok) {
      console.warn("[resend-webhook] rejected: bad signature");
      return json({ error: "invalid signature" }, 401);
    }
  } else {
    console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET not set — processing UNVERIFIED");
  }

  // deno-lint-ignore no-explicit-any
  let evt: any;
  try { evt = JSON.parse(payload); } catch { return json({ error: "bad json" }, 400); }

  const type = String(evt?.type ?? "");

  // ── Engagement events. Recorded and returned early: an open is not a
  //    suppression signal, it is the opposite, and record_email_engagement()
  //    lifts the sender straight back to the 'warm' tier.
  if (type === "email.opened" || type === "email.clicked" || type === "email.delivered") {
    const event = type.slice("email.".length);      // opened | clicked | delivered
    const emails = extractEmails(evt?.data);
    if (!emails.length) return json({ ok: true, note: "no recipient in payload" });
    const tags = readTags(evt?.data);
    // deno-lint-ignore no-explicit-any
    const d = (evt?.data ?? {}) as any;
    const link = event === "clicked" ? String(d?.click?.link ?? d?.link ?? "") || null : null;
    const occurred = String(d?.created_at ?? evt?.created_at ?? "") || new Date().toISOString();
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let recorded = 0;
    for (const email of emails) {
      const { error } = await sb.rpc("record_email_engagement", {
        p_email: email,
        p_event: event,
        p_message_id: d?.email_id ?? d?.id ?? null,
        p_campaign: tags.campaign ?? null,
        p_slot: tags.slot ?? null,
        p_url: link,
        p_occurred: occurred,
      });
      if (error) console.error("[resend-webhook] engagement record failed", email, error.message);
      else recorded++;
    }
    return json({ ok: true, event, recorded });
  }

  // Complaints ALWAYS mean "never email this address again". Bounces only when
  // PERMANENT (hard) — transient/undetermined bounces are temporary (full mailbox,
  // server busy, greylisting) and must NOT permanently suppress a valid address.
  let reason: string | null = null;
  if (type === "email.complained") {
    reason = "complaint";
  } else if (type === "email.bounced") {
    // deno-lint-ignore no-explicit-any
    const bt = String((evt?.data as any)?.bounce?.type ?? "").toLowerCase();
    if (bt === "permanent") reason = "bounce";
    else return json({ ok: true, ignored: `bounce:${bt || "unknown"} (not permanent)` });
  }
  if (!reason) return json({ ok: true, ignored: type || "unknown" });

  const emails = extractEmails(evt?.data);
  if (!emails.length) return json({ ok: true, note: "no recipient in payload" });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();

  for (const email of emails) {
    try {
      // 1) Global do-not-email hub — campaigns already skip anyone in here;
      //    the digest and transactional functions check it too.
      await sb.from("email_unsubscribes")
        .upsert({ email, unsubscribed_at: now, reason }, { onConflict: "email" });

      // 2) Stop any still-queued campaign rows for this address immediately.
      await sb.from("email_campaign_recipients")
        .update({ status: "skipped_unsub", error_message: `auto-suppressed (${reason})` })
        .eq("email", email)
        .eq("status", "queued");
    } catch (e) {
      console.error("[resend-webhook] suppress failed for", email, e);
    }
  }

  console.log(`[resend-webhook] suppressed ${emails.length} (${reason}):`, emails.join(", "));
  return json({ ok: true, reason, suppressed: emails.length });
});

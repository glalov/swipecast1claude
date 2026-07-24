import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Fired when a CD PASSES the real ID check (Didit/Persona). We deliberately do NOT
// grant posting here — an admin must click "Allow posting" in CD Verification.
// This just tells the admins the ID check passed and is awaiting their approval.
async function notifyIdVerified(admin: ReturnType<typeof createClient>, userId: string) {
  try {
    const { data: cd } = await admin.from("profiles").select("display_name,email").eq("id", userId).maybeSingle();
    const name = (cd?.display_name || cd?.email || "A casting director") as string;
    const email = (cd?.email || "—") as string;

    const { data: admins } = await admin.from("profiles").select("id").in("user_type", ["admin", "super_admin"]);
    const rows = (admins ?? []).map((a: { id: string }) => ({
      user_id: a.id,
      type: "cd_id_verified",
      title: "CD passed ID verification",
      body: `${name} passed the ID check and is awaiting your approval to post. Open CD Verification and click "Allow posting".`,
      link_url: "/admin#cd-verification",
    }));
    if (rows.length) await admin.from("system_notifications").insert(rows);

    const key = Deno.env.get("RESEND_API_KEY");
    if (key) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CastSlate <notifications@castslate.com>",
          to: [Deno.env.get("CONTACT_EMAIL") ?? "team@castslate.com"],
          subject: `✅ ${name} passed ID verification`,
          html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1b2e;line-height:1.6;">
            <p><strong>${esc(name)}</strong> (${esc(email)}) just passed the ID check.</p>
            <p>They <strong>cannot post yet</strong>. Open <a href="https://www.castslate.com/admin#cd-verification" style="color:#37696A;">CD Verification</a>, confirm their verified ID, and click <strong>"Allow posting"</strong> to grant access.</p>
          </div>`,
        }),
      });
    }
  } catch (e) {
    console.error("notifyIdVerified failed (non-fatal):", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.text();
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(body); } catch { return json({ error: "invalid_json" }, 400); }

    const { data: rows } = await adminClient
      .from("app_secrets")
      .select("key, value")
      .in("key", ["didit_webhook_secret", "persona_webhook_secret"]);
    const s = Object.fromEntries((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const diditSecret   = s["didit_webhook_secret"] ?? "";
    const personaSecret = s["persona_webhook_secret"] ?? "";

    const now = new Date().toISOString();

    // ── Didit v3 webhook ──────────────────────────────────────────
    const diditSig = req.headers.get("x-hmac-signature") ??
                     req.headers.get("x-didit-hmac-sha256") ??
                     req.headers.get("x-signature") ?? "";

    if (diditSig && diditSecret) {
      const expected = await hmacHex(diditSecret, body);
      if (!safeEqual(diditSig, expected)) {
        console.error("Didit signature mismatch", { received: diditSig, expected });
        return json({ error: "invalid_signature" }, 401);
      }
    }

    const event      = payload.event as string ?? "";
    const data       = payload.data as Record<string, unknown> ?? {};
    const vendorData = data.vendor_data as string ?? payload.vendor_data as string ?? "";
    const status     = data.status as string ?? payload.status as string ?? "";
    const sessionId  = data.session_id as string ?? payload.session_id as string ?? "";

    if (vendorData && (event === "status.updated" || event === "data.updated" || status)) {
      if (status === "APPROVED") {
        // ID PASSED — mark identity verified, but do NOT grant posting.
        // Posting requires an explicit admin "Allow posting" click.
        await adminClient.from("profiles").update({
          verification_status:      "verified",
          identity_verified:        true,
          verification_provider:    "didit",
          verification_session_id:  sessionId || null,
          verification_approved_at: now,
          verification_rejected_at: null,
          updated_at: now,
        }).eq("id", vendorData);
        console.log("Didit: ID verified (awaiting admin posting approval)", vendorData);
        await notifyIdVerified(adminClient, vendorData);
      } else if (status === "DECLINED") {
        await adminClient.from("profiles").update({
          verification_status:      "rejected",
          identity_verified:        false,
          can_post_castings:        false,
          verification_rejected_at: now,
          updated_at: now,
        }).eq("id", vendorData);
        console.log("Didit: declined", vendorData);
      } else if (status === "REVIEW_NEEDED" || status === "PENDING") {
        await adminClient.from("profiles").update({
          verification_status: "needs_review",
          updated_at: now,
        }).eq("id", vendorData);
        console.log("Didit: needs_review", vendorData);
      }
      return json({ ok: true });
    }

    // ── Persona webhook (fallback) ────────────────────────────────
    const personaSigHeader = req.headers.get("persona-signature") ?? req.headers.get("x-persona-signature") ?? "";
    if (personaSigHeader && personaSecret) {
      const tPart   = personaSigHeader.split(",").find((p: string) => p.startsWith("t="))?.slice(2) ?? "";
      const sigPart = personaSigHeader.split(",").find((p: string) => p.startsWith("sha256="))?.slice(7) ?? "";
      const expected = await hmacHex(personaSecret, tPart ? `${tPart}.${body}` : body);
      if (!safeEqual(sigPart, expected)) return json({ error: "invalid_persona_signature" }, 401);
    }

    const eventType  = (payload.data as Record<string,unknown>)?.type as string ?? "";
    const attrs      = (payload.data as Record<string,unknown>)?.attributes as Record<string,unknown> ?? {};
    const refId      = attrs["reference-id"] as string ?? "";
    const inquiryId  = (payload.data as Record<string,unknown>)?.id as string ?? "";

    if (refId && eventType.startsWith("inquiry.")) {
      const passed      = ["inquiry.completed", "inquiry.approved"].includes(eventType);
      const rejected    = ["inquiry.failed", "inquiry.declined", "inquiry.expired"].includes(eventType);
      const needsReview = eventType === "inquiry.needs-review";
      if (passed) {
        // ID PASSED — verify identity, but do NOT grant posting (admin must allow).
        await adminClient.from("profiles").update({
          verification_status: "verified", identity_verified: true,
          verification_provider: "persona", verification_session_id: inquiryId || null,
          verification_approved_at: now, verification_rejected_at: null, updated_at: now,
        }).eq("id", refId);
        await notifyIdVerified(adminClient, refId);
      } else if (rejected) {
        await adminClient.from("profiles").update({
          verification_status: "rejected", identity_verified: false, can_post_castings: false,
          verification_rejected_at: now, updated_at: now,
        }).eq("id", refId);
      } else if (needsReview) {
        await adminClient.from("profiles").update({ verification_status: "needs_review", updated_at: now }).eq("id", refId);
      }
      return json({ ok: true });
    }

    return json({ ok: true, note: "event_not_handled" });
  } catch (err) {
    console.error("verification-webhook error:", err);
    return json({ error: String(err) }, 500);
  }
});

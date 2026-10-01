// Casting indexer (2026-10-01) — tells search engines about new castings fast.
//
// Runs every 2 hours (cron casting-indexer → public.run_casting_indexer()).
// It never contacts people; it only notifies search engines about our own pages.
//   1. Finds castings that went live recently (approved, published, go-live
//      reached) and have not been announced yet (seo_index_pings, one row per URL).
//   2. IndexNow (Bing, Yandex, Seznam, Naver…) for every new casting URL.
//   3. Google Indexing API for real openings only — castings a CD posted, or admin
//      castings the owner marked real_hirer. Those are the pages carrying
//      JobPosting data (api/casting-og.js), which is
//      the only page type Google lets this API be used for. Also re-notifies
//      Google once when such a casting closes, so the job listing drops quickly.
//      Needs app_secrets.gsc_service_account, and that service account must be an
//      OWNER of the Search Console property; until then this step is skipped.
//
// POST {secret, action:"run"}; secret = app_secrets.seo_agent_secret (same as seo-agent).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ORIGIN = "https://www.castslate.com";
const INDEXNOW_KEY = "a6124d7bc19f64d5eba71e5868b9a59a";
const LOOKBACK_DAYS = 30;     // first run announces everything live from the last month
const GOOGLE_MAX_PER_RUN = 50; // Indexing API quota is 200/day
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function b64url(buf: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function googleToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/indexing",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url(sig)}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("Google sign-in failed: " + JSON.stringify(d).slice(0, 200));
  return d.access_token;
}

type C = { id: string; slug: string; is_admin_created: boolean | null; real_hirer?: boolean | null; status: string; deadline: string | null; expires_at: string | null };
const isRealJob = (c: C) => c.is_admin_created !== true || c.real_hirer === true;
const urlOf = (slug: string) => `${ORIGIN}/casting/${encodeURIComponent(slug)}`;

// deno-lint-ignore no-explicit-any
async function run(sb: any) {
  const notes: string[] = [];
  const nowIso = new Date().toISOString();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  const today = nowIso.slice(0, 10);

  // Live castings that became public in the lookback window.
  const { data: live, error: liveErr } = await sb.from("castings")
    .select("id,slug,is_admin_created,real_hirer,status,deadline,expires_at,approved_at,go_live_at")
    .eq("status", "open").eq("published", true).not("slug", "is", null).not("approved_at", "is", null)
    .or(`approved_at.gte.${since},go_live_at.gte.${since}`)
    .limit(1000);
  if (liveErr) throw new Error("castings query: " + liveErr.message);
  const isLive = (c: C & { go_live_at: string | null }) =>
    (!c.go_live_at || c.go_live_at <= nowIso) &&
    (!c.deadline || c.deadline >= today) && (!c.expires_at || c.expires_at > nowIso);
  const fresh = ((live || []) as (C & { go_live_at: string | null })[]).filter(isLive);

  const { data: done } = await sb.from("seo_index_pings").select("url,kind,google_status")
    .in("url", fresh.map((c) => urlOf(c.slug)).concat(["__none__"]));
  const seen = new Set((done || []).filter((d: { kind: string }) => d.kind === "new").map((d: { url: string }) => d.url));
  const toAnnounce = fresh.filter((c) => !seen.has(urlOf(c.slug)));

  // Real-CD castings we told Google about that have since closed → tell Google once more.
  const { data: googled } = await sb.from("seo_index_pings").select("url,casting_id")
    .eq("kind", "new").eq("google_status", "200").limit(1000);
  const { data: closedDone } = await sb.from("seo_index_pings").select("url").eq("kind", "closed").limit(5000);
  const closedSeen = new Set((closedDone || []).map((d: { url: string }) => d.url));
  const googledIds = (googled || []).filter((g: { url: string }) => !closedSeen.has(g.url)).map((g: { casting_id: string }) => g.casting_id);
  let closed: C[] = [];
  if (googledIds.length) {
    const { data: rows } = await sb.from("castings").select("id,slug,is_admin_created,real_hirer,status,deadline,expires_at").in("id", googledIds);
    closed = ((rows || []) as C[]).filter((c) => c.status !== "open" || (c.deadline && c.deadline < today) || (c.expires_at && c.expires_at <= nowIso));
  }

  // IndexNow — every newly live casting (plus Browse, which lists it).
  let indexnow = 0;
  if (toAnnounce.length) {
    const urlList = toAnnounce.map((c) => urlOf(c.slug)).concat([`${ORIGIN}/browse-castings`]);
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: "www.castslate.com", key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList }),
    }).catch((e) => { notes.push("IndexNow failed: " + String(e)); return null; });
    if (r && (r.status === 200 || r.status === 202)) indexnow = toAnnounce.length;
    else if (r) notes.push(`IndexNow answered ${r.status}`);
  }

  // Earlier real-CD castings Google hasn't accepted yet (key not connected then,
  // quota, a hiccup) — retried every run while they are still live.
  const { data: pend } = await sb.from("seo_index_pings").select("casting_id")
    .eq("kind", "new").or("google_status.is.null,and(google_status.neq.200,google_status.neq.skip)").limit(200);
  let retry: C[] = [];
  const pendIds = (pend || []).map((p: { casting_id: string }) => p.casting_id).filter(Boolean);
  if (pendIds.length) {
    const { data: rows } = await sb.from("castings").select("id,slug,is_admin_created,real_hirer,status,deadline,expires_at,go_live_at").in("id", pendIds);
    retry = ((rows || []) as (C & { go_live_at: string | null })[]).filter((c) => isRealJob(c) && c.status === "open" && isLive(c));
  }

  // Google Indexing API — real-CD castings only (JobPosting pages).
  const googleStatus = new Map<string, string>();
  const forGoogle = [
    ...toAnnounce.filter(isRealJob).map((c) => ({ c, kind: "new" })),
    ...retry.map((c) => ({ c, kind: "retry" })),
    ...closed.map((c) => ({ c, kind: "closed" })),
  ].slice(0, GOOGLE_MAX_PER_RUN);
  let google = 0;
  if (forGoogle.length) {
    const { data: saRow } = await sb.from("app_secrets").select("value").eq("key", "gsc_service_account").maybeSingle();
    if (!saRow?.value) notes.push("Google step skipped: Search Console key not connected (Admin → SEO Agent → Connect Google).");
    else {
      try {
        const token = await googleToken(JSON.parse(saRow.value));
        for (const { c, kind } of forGoogle) {
          const r = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: urlOf(c.slug), type: "URL_UPDATED" }),
          });
          googleStatus.set(kind + ":" + c.id, String(r.status));
          if (r.ok) google++;
          else if (r.status === 403) {
            // 403 has two common causes: the Indexing API isn't enabled in the Google Cloud
            // project, or the service account isn't an Owner of the Search Console property.
            const why = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
            notes.push(/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(why)
              ? "Google refused (403): turn on the Indexing API in Google Cloud. " + why
              : "Google refused (403): the service account must be an OWNER in Search Console. " + why);
            break;
          }
          else if (r.status === 429) { notes.push("Google daily quota reached; the rest go next run."); break; }
        }
      } catch (e) { notes.push(String(e).slice(0, 200)); }
    }
  }

  // Record what was announced so nothing is sent twice. A casting only counts as
  // announced if IndexNow accepted it; Google-only failures are retried next run.
  const rows = [
    ...(indexnow ? toAnnounce.map((c) => ({ url: urlOf(c.slug), casting_id: c.id, kind: "new", indexnow_at: nowIso,
      // Castings not marked as real openings never go to Google (no JobPosting) — mark them so retries skip them.
      google_status: !isRealJob(c) ? "skip" : (googleStatus.get("new:" + c.id) ?? null) })) : []),
    ...closed.filter((c) => googleStatus.get("closed:" + c.id) === "200").map((c) => ({ url: urlOf(c.slug), casting_id: c.id, kind: "closed", google_status: "200" })),
  ];
  if (rows.length) await sb.from("seo_index_pings").upsert(rows, { onConflict: "url,kind" });
  for (const c of retry) {
    const st = googleStatus.get("retry:" + c.id);
    if (st) await sb.from("seo_index_pings").update({ google_status: st }).eq("url", urlOf(c.slug)).eq("kind", "new");
  }

  return { announced: toAnnounce.length, indexnow, google, retried: retry.length, closed: closed.length, notes };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Not found", { status: 404 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "seo_agent_secret").maybeSingle();
    if (!sec?.value || body.secret !== sec.value) return json({ error: "Unauthorized" }, 401);
    if (body.action !== "run") return json({ error: "Unknown action" }, 400);
    const r = await run(sb);
    await sb.from("seo_index_runs").insert({ announced: r.announced, indexnow: r.indexnow, google: r.google, closed: r.closed, notes: r.notes.join(" | ") || null });
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("[indexer] error", String(e));
    await sb.from("seo_index_runs").insert({ notes: "error: " + String(e).slice(0, 300) });
    return json({ error: String(e) }, 500);
  }
});

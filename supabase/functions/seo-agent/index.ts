// SEO agent (2026-09-30) — weekly, fully autonomous, works ONLY on castslate.com.
//
// It never contacts anyone. Each Monday it:
//   1. reads the last 28 days of Google Search Console data (read-only access),
//   2. stores per-page weekly stats (seo_page_stats),
//   3. creates up to 2 new landing pages (seo_landing_pages → /casting-calls/<key>)
//      for real searches people made, ONLY when >= 3 live castings match,
//   4. rewrites title/description of its OWN pages that are seen but rarely
//      clicked, and reverts a rewrite after 4 weeks if clicks got worse,
//   5. pings IndexNow for new pages and emails the owner a short report.
// Built-in pages and the rest of the site are never edited.
//
// POST {secret, action: "run" | "status"}; secret = app_secrets.seo_agent_secret.
// Search Console access = app_secrets.gsc_service_account (service-account JSON).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SITE = "https://www.castslate.com/";
const ORIGIN = "https://www.castslate.com";
const REPORT_TO = "officecasting01@gmail.com";
const INDEXNOW_KEY = "a6124d7bc19f64d5eba71e5868b9a59a";
const BUILTIN = ["new-york", "film", "student-films", "short-films", "commercials", "tv-and-streaming", "non-union", "sag-aftra", "theater"];
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest"];
const MAX_NEW_PAGES = 2;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const day = (d: Date) => d.toISOString().slice(0, 10);

// ── matching (same rules as api/landing.js + canonCastingCity in the app) ─────
const NY_TERMS: string[] = ["new york","new york, ny","new york,ny","nyc","n.y.c","manhattan","brooklyn","queens","the bronx","bronx","staten island","long island","yonkers","westchester","jersey city","hoboken","newark","north jersey","new jersey","nj","nassau","suffolk","harlem","astoria","flushing","the heights","washington heights","upper east","upper west","midtown","downtown","tribeca","soho","noho","lower east","east village","west village","chelsea","flatiron","gramercy","murray hill","hell's kitchen","lincoln center","inwood","riverdale","soundview","fordham","jamaica","corona","elmhurst","ridgewood","bay ridge","bensonhurst","park slope","williamsburg","bushwick","bedford","crown heights","flatbush","east new york","rockaway","fresh meadows","bayside","forest hills","rego park","sunnyside","woodside","jackson heights","maspeth","north bergen","weehawken","union city","bayonne"];
const LA_TERMS: string[] = ["los angeles","los angeles, ca","los angeles,ca","la","l.a.","hollywood","west hollywood","weho","burbank","glendale","pasadena","santa monica","culver city","studio city","north hollywood","noho","long beach","compton","inglewood","torrance","hawthorne","el segundo","manhattan beach","hermosa beach","redondo beach","venice","marina del rey","playa vista","playa del rey","westwood","brentwood","bel air","beverly hills","west la","koreatown","echo park","silver lake","los feliz","atwater village","eagle rock","highland park","monterey park","alhambra","arcadia","san gabriel","the valley","sherman oaks","encino","van nuys","reseda","chatsworth","thousand oaks","calabasas","malibu","pomona","ontario","rancho cucamonga","san bernardino"];
function locHasTerm(loc: string, term: string) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])", "i").test(loc);
}
function canonCity(loc: unknown): string {
  const l = String(loc ?? "").replace(/\s+/g, " ").trim();
  if (!l) return "";
  const low = l.toLowerCase();
  if (locHasTerm(low, "new york") || NY_TERMS.some((t) => locHasTerm(low, t))) return "New York";
  if (locHasTerm(low, "los angeles") || LA_TERMS.some((t) => locHasTerm(low, t))) return "Los Angeles";
  return l.split(",")[0].trim().replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}
function safeRe(src: unknown): RegExp | null {
  if (!src) return null;
  try { return new RegExp(String(src).slice(0, 200), "i"); } catch { return null; }
}
type Rules = { city?: string | null; type_re?: string | null; union_re?: string | null; text_re?: string | null };
type Casting = { title: string; type: string; location: string; union_status: string; tagline: string };
function matchRules(c: Casting, r: Rules) {
  if (r.city && canonCity(c.location) !== r.city) return false;
  const t = safeRe(r.type_re), u = safeRe(r.union_re), x = safeRe(r.text_re);
  if (r.type_re && !(t && t.test(String(c.type || "")))) return false;
  if (r.union_re && !(u && u.test(String(c.union_status || "")))) return false;
  if (r.text_re && !(x && x.test(`${c.title || ""} ${c.tagline || ""}`))) return false;
  return true;
}

// ── Google Search Console (service account, read-only) ───────────────────────
function b64url(buf: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function gscToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly",
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
type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
async function gscQuery(token: string, dims: string[], start: string, end: string, limit = 1000): Promise<Row[]> {
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: dims, rowLimit: limit, dataState: "final" }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Search Console query failed: " + JSON.stringify(d).slice(0, 300));
  return d.rows || [];
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function gemini(key: string, system: string, prompt: string, search = false): Promise<unknown> {
  // Google Search grounding can't be combined with JSON mode, so in search mode
  // the JSON is pulled out of the text instead.
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096, ...(search ? {} : { responseMimeType: "application/json" }) },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  });
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!r.ok) { console.error("[seo] gemini", model, r.status); continue; }
      const d = await r.json();
      const text = (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      try { return JSON.parse(clean); } catch { /* try the outermost {...} */ }
      const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
      if (a >= 0 && b > a) { try { return JSON.parse(clean.slice(a, b + 1)); } catch { /* next */ } }
    } catch (e) { console.error("[seo] gemini fail", model, String(e)); }
  }
  return null;
}

const PAGE_SYSTEM = `You design landing pages for CastSlate, a casting-call website, based on real Google searches.
Each page lists live casting calls that match simple rules. Return JSON: {"pages":[...]} with at most 4 objects:
{"key":"lowercase-hyphen-slug","label":"short page heading","title":"<= 60 chars, ends with | CastSlate","description":"<= 155 chars, honest, inviting","city":"canonical city or null","type_re":"regex or null","union_re":"regex or null","text_re":"regex or null","source_query":"the search it targets"}
Rules: only propose pages for searches by people looking for acting work/castings/auditions. city must be exactly one of the canonical cities given, or null.
type_re matches the casting type field (values listed), union_re the union field, text_re the title+tagline. Keep regexes simple (alternation of words).
Never promise anything untrue (no "paid" unless the rule only matches paid work, no numbers). Do not duplicate an existing page.`;
const TITLE_SYSTEM = `You rewrite one search-result title and description for a CastSlate casting-calls landing page to earn more clicks from people searching for it.
Return JSON {"title":"<= 60 chars, ends with | CastSlate","description":"<= 155 chars"}. Honest, specific, no clickbait, no numbers you can't know, no emojis.`;

// ── run ───────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function run(sb: any) {
  const notes: string[] = [];
  let key: string | null = null;
  try { const { data } = await sb.rpc("news_get_gemini_key"); if (typeof data === "string" && data) key = data; } catch { /* */ }
  if (!key) return { notes: ["No Gemini key — nothing done."], impressions: 0, clicks: 0, created: [], retitled: [] };

  // Real Search Console numbers when connected; otherwise ("no-key mode") Gemini's
  // Google Search finds what actors commonly search for, and the same page-creation
  // pipeline runs on those. Title tests need real click data, so they wait for the key.
  const { data: saRow } = await sb.from("app_secrets").select("value").eq("key", "gsc_service_account").maybeSingle();
  let queries: Row[] = [], pages: Row[] = [];
  let impressions = 0, clicks = 0;
  const gscMode = !!saRow?.value;
  if (gscMode) {
    const token = await gscToken(JSON.parse(saRow.value));
    const end = new Date(Date.now() - 3 * 86400000), start = new Date(end.getTime() - 27 * 86400000);
    [queries, pages] = await Promise.all([
      gscQuery(token, ["query"], day(start), day(end), 1000),
      gscQuery(token, ["page"], day(start), day(end), 1000),
    ]);
    impressions = pages.reduce((a, r) => a + r.impressions, 0); clicks = pages.reduce((a, r) => a + r.clicks, 0);
    const wkStart = new Date(end.getTime() - 6 * 86400000);
    const week = await gscQuery(token, ["page"], day(wkStart), day(end), 1000);
    if (week.length) {
      await sb.from("seo_page_stats").upsert(week.map((r) => ({ page: r.keys[0], week_start: day(wkStart), impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10 })), { onConflict: "page,week_start" });
    }
  } else {
    notes.push("Running without Search Console data (no key) — search ideas come from Google Search via Gemini.");
    const out = await gemini(key, "You research what people type into Google when looking for acting work. Use Google Search. Reply with ONLY JSON.",
      `Find 30 specific, real Google search phrases that actors in the United States (especially New York City) use to find casting calls, auditions or acting jobs — e.g. by city/borough, project type (student film, short film, commercial, theater, web series), union status, age group or role type. Return {"queries":["...", ...]} — lowercase phrases only.`, true) as { queries?: string[] } | null;
    queries = (out?.queries || []).filter((q) => typeof q === "string" && q.length < 90).slice(0, 40)
      .map((q) => ({ keys: [q.toLowerCase().trim()], clicks: 0, impressions: 5, ctr: 0, position: 0 }));
    if (!queries.length) notes.push("Google Search via Gemini returned no ideas this week.");
  }

  // live castings (same definition of live as Browse / api/landing.js)
  const nowIso = new Date().toISOString(), today = nowIso.slice(0, 10);
  const { data: liveRaw } = await sb.from("castings").select("title,type,location,union_status,tagline,go_live_at,expires_at,deadline")
    .eq("published", true).eq("status", "open").limit(1000);
  const live: Casting[] = (liveRaw || []).filter((c: { go_live_at: string | null; expires_at: string | null; deadline: string | null }) =>
    (!c.go_live_at || c.go_live_at <= nowIso) && (!c.expires_at || c.expires_at > nowIso) && (!c.deadline || String(c.deadline).slice(0, 10) >= today));

  const { data: existing } = await sb.from("seo_landing_pages").select("*");
  const existingKeys = new Set([...BUILTIN, ...(existing || []).map((p: { key: string }) => p.key)]);

  // ── 1. new pages for real searches ────────────────────────────────────────
  const created: string[] = [];
  const castingWords = /(cast|audition|acting|actor|actress|role|extra|background|model|voice ?over|film|theat|commercial|student)/i;
  const cand = queries.filter((q) => castingWords.test(q.keys[0]) && q.impressions >= 2)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 40);
  if (cand.length && live.length) {
    const cities = [...new Set(live.map((c) => canonCity(c.location)).filter(Boolean))];
    const types = [...new Set(live.map((c) => c.type).filter(Boolean))];
    const unions = [...new Set(live.map((c) => c.union_status).filter(Boolean))];
    const prompt = `Searches (query — impressions, clicks, avg position):
${cand.map((q) => `${q.keys[0]} — ${q.impressions}, ${q.clicks}, ${q.position.toFixed(1)}`).join("\n")}

Existing page keys (do not duplicate): ${[...existingKeys].join(", ")}
Canonical cities with live castings: ${cities.join(", ")}
Casting types in use: ${types.join(" | ")}
Union values in use: ${unions.join(" | ")}`;
    const out = await gemini(key, PAGE_SYSTEM, prompt) as { pages?: Record<string, string | null>[] } | null;
    for (const p of out?.pages || []) {
      if (created.length >= MAX_NEW_PAGES) break;
      const k = String(p.key || "").toLowerCase().trim();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(k) || k.length < 3 || k.length > 60 || existingKeys.has(k)) continue;
      const rules: Rules = { city: p.city || null, type_re: p.type_re || null, union_re: p.union_re || null, text_re: p.text_re || null };
      if (rules.city && !cities.includes(rules.city)) continue;
      if ([rules.type_re, rules.union_re, rules.text_re].some((r) => r && !safeRe(r))) continue;
      if (!rules.city && !rules.type_re && !rules.union_re && !rules.text_re) continue;
      const n = live.filter((c) => matchRules(c, rules)).length;
      if (n < 3) continue;
      const title = String(p.title || "").slice(0, 70), label = String(p.label || "").slice(0, 60), desc = String(p.description || "").slice(0, 170);
      if (!title || !label || !desc) continue;
      const { error } = await sb.from("seo_landing_pages").insert({ key: k, label, title, description: desc, ...rules, source_query: String(p.source_query || "").slice(0, 200) });
      if (!error) { created.push(k); existingKeys.add(k); }
    }
  }

  // ── 2. retitle the agent's own pages: seen but rarely clicked ─────────────
  const retitled: string[] = [];
  const byPage = new Map(pages.map((r) => [r.keys[0].replace(/\/$/, ""), r]));
  for (const p of existing || []) {
    if (!p.active || p.created_by !== "seo-agent") continue;
    const url = `${ORIGIN}/casting-calls/${p.key}`;
    const stat = byPage.get(url);
    const changedAt = p.title_changed_at ? new Date(p.title_changed_at).getTime() : 0;
    const ageWeeks = (Date.now() - new Date(p.created_at).getTime()) / (7 * 86400000);
    // judge an earlier rewrite after 4 weeks: revert if clicks per impression dropped
    if (p.prev_title && changedAt && Date.now() - changedAt > 28 * 86400000) {
      const { data: hist } = await sb.from("seo_page_stats").select("week_start,impressions,clicks").eq("page", url);
      const before = (hist || []).filter((h: { week_start: string }) => new Date(h.week_start).getTime() < changedAt);
      const after = (hist || []).filter((h: { week_start: string }) => new Date(h.week_start).getTime() >= changedAt);
      const rate = (a: { impressions: number; clicks: number }[]) => { const i = a.reduce((s, h) => s + h.impressions, 0); return i ? a.reduce((s, h) => s + h.clicks, 0) / i : 0; };
      if (after.length && before.length && rate(after) < rate(before)) {
        await sb.from("seo_landing_pages").update({ title: p.prev_title, description: p.prev_description, prev_title: null, prev_description: null, title_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("key", p.key);
        notes.push(`Reverted the title of /casting-calls/${p.key} (the new one got fewer clicks).`);
      } else {
        await sb.from("seo_landing_pages").update({ prev_title: null, prev_description: null }).eq("key", p.key);
      }
      continue;
    }
    if (!stat || ageWeeks < 4 || stat.impressions < 50 || stat.ctr >= 0.015) continue;
    if (changedAt && Date.now() - changedAt < 28 * 86400000) continue;
    if (retitled.length >= 2) break;
    const out = await gemini(key, TITLE_SYSTEM, `Current title: ${p.title}\nCurrent description: ${p.description}\nPage lists casting calls for: ${p.label}\nTarget search: ${p.source_query || p.label}\nLast 28 days: ${stat.impressions} impressions, ${stat.clicks} clicks, average position ${stat.position.toFixed(1)}.`) as { title?: string; description?: string } | null;
    const t = String(out?.title || "").slice(0, 70), d = String(out?.description || "").slice(0, 170);
    if (!t || !d || t === p.title) continue;
    await sb.from("seo_landing_pages").update({ prev_title: p.title, prev_description: p.description, title: t, description: d, title_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("key", p.key);
    retitled.push(p.key);
  }

  // ── 3. tell Bing & co about new / changed pages ───────────────────────────
  const urls = [...created, ...retitled].map((k) => `${ORIGIN}/casting-calls/${k}`);
  if (urls.length) {
    await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "www.castslate.com", key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls }) }).catch(() => {});
  }
  return { notes, impressions, clicks, created, retitled, queries };
}

function esc(s: string) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function report(r: { notes: string[]; impressions: number; clicks: number; created: string[]; retitled: string[]; queries?: Row[] }) {
  if (!RESEND_API_KEY) return;
  const top = (r.queries || []).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 10);
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;font-size:14px;color:#1A1A2E;max-width:620px">
<h2 style="margin:0 0 6px">CastSlate on Google — weekly report</h2>
${r.impressions || r.clicks ? `<p style="margin:0 0 12px">Last 28 days: <b>${r.impressions.toLocaleString()}</b> times shown in Google results, <b>${r.clicks.toLocaleString()}</b> clicks to the site.</p>` : `<p style="margin:0 0 12px">Google click numbers appear here once Search Console is connected.</p>`}
${r.created.length ? `<p style="margin:0 0 8px"><b>New pages created:</b><br/>${r.created.map((k) => `<a href="${ORIGIN}/casting-calls/${k}">${ORIGIN}/casting-calls/${k}</a>`).join("<br/>")}</p>` : `<p style="margin:0 0 8px">No new pages this week.</p>`}
${r.retitled.length ? `<p style="margin:0 0 8px"><b>Titles improved:</b> ${r.retitled.map(esc).join(", ")}</p>` : ""}
${r.notes.length ? `<p style="margin:0 0 8px;color:#8A5A12">${r.notes.map(esc).join("<br/>")}</p>` : ""}
${top.length && (r.impressions || r.clicks) ? `<h3 style="margin:16px 0 6px">Top searches</h3><table style="border-collapse:collapse;font-size:13px">${top.map((q) => `<tr><td style="padding:3px 12px 3px 0">${esc(q.keys[0])}</td><td style="padding:3px 8px;color:#5A5A72">${q.impressions} shown</td><td style="padding:3px 8px;color:#5A5A72">${q.clicks} clicks</td></tr>`).join("")}</table>` : ""}
</div>`;
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "CastSlate SEO Agent <notifications@castslate.com>", to: [REPORT_TO], subject: r.impressions || r.clicks ? `Google this month: ${r.clicks} clicks · ${r.created.length} new page${r.created.length === 1 ? "" : "s"}` : `SEO agent: ${r.created.length} new page${r.created.length === 1 ? "" : "s"} this week`, html }) }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Not found", { status: 404 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "seo_agent_secret").maybeSingle();
    if (!sec?.value || body.secret !== sec.value) return json({ error: "Unauthorized" }, 401);
    if (body.action === "status") {
      const { data: gsc } = await sb.from("app_secrets").select("key").eq("key", "gsc_service_account").maybeSingle();
      const { data: pages } = await sb.from("seo_landing_pages").select("key,title,active,created_at");
      return json({ ok: true, search_console_connected: !!gsc, agent_pages: pages || [] });
    }
    if (body.action !== "run") return json({ error: "Unknown action" }, 400);
    const r = await run(sb);
    await sb.from("seo_agent_runs").insert({ impressions: r.impressions, clicks: r.clicks, pages_created: r.created.length, titles_changed: r.retitled.length, notes: r.notes.join(" | ") || null });
    if (body.report !== false) await report(r);
    return json({ ok: true, impressions: r.impressions, clicks: r.clicks, created: r.created, retitled: r.retitled, notes: r.notes });
  } catch (e) {
    console.error("[seo] error", String(e));
    await sb.from("seo_agent_runs").insert({ notes: "error: " + String(e).slice(0, 300) }).catch(() => {});
    return json({ error: String(e) }, 500);
  }
});

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
// Since 2026-11-25 it uses NO AI: page ideas and title tests come from fixed rules
// (idea(), TITLE_VARIANTS). action:"dry" previews a run without writing or emailing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SITE = "https://www.castslate.com/";
const ORIGIN = "https://www.castslate.com";
const REPORT_TO = "officecasting01@gmail.com";
const INDEXNOW_KEY = "a6124d7bc19f64d5eba71e5868b9a59a";
const NYC_KEY = /(^|-)(nyc|new-?york|ny|manhattan|brooklyn|queens|bronx|staten-island)(-|$)/;
const BUILTIN = ["new-york", "film", "student-films", "short-films", "commercials", "tv-and-streaming", "non-union", "sag-aftra", "theater"];
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

// ── rule-based page ideas (no AI since 2026-11-25: Gemini credits ran out, owner on a budget) ──
// A real search is turned into a page only when its words map cleanly onto casting fields:
// a city (never New York — one NYC page), a project type, union status, or a role kind.
const TYPE_MAP: [RegExp, string, string][] = [
  [/student/, "student", "Student film"], [/short film|shorts\b/, "short", "Short film"], [/commercial/, "commercial", "Commercial"],
  [/theat|musical|broadway|stage play/, "theat|musical|stage", "Theater"], [/web series|tv|television|series|streaming/, "tv|series|web|stream", "TV & series"],
  [/feature/, "feature", "Feature film"], [/music video/, "music video", "Music video"], [/indie|independent/, "indie|independent", "Indie film"],
];
const TEXT_MAP: [RegExp, string, string][] = [
  [/extra|background/, "extra|background", "Background & extras"], [/voice ?over|voice acting/, "voice", "Voice-over"],
  [/model/, "model", "Modeling"], [/kid|child|teen|youth|minor/, "kid|child|teen|youth|minor", "Kids & teens"],
];
const UNION_MAP: [RegExp, string, string][] = [[/non[- ]?union/, "non", "Non-union"], [/\bsag\b|sag-aftra|union/, "sag", "SAG-AFTRA"]];
const LA_Q = /\b(los angeles|l\.?a\.?|hollywood|burbank|santa monica|long beach)\b/;
function slugify(s: string) { return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function idea(q: string, cities: string[]): { key: string; label: string; title: string; description: string; rules: Rules } | null {
  const l = q.toLowerCase();
  if (/castslate|backstage|actors access|nycastings|casting networks/.test(l)) return null;
  if (/\b(nyc|new york|manhattan|brooklyn|queens|bronx|staten island)\b/.test(l)) return null; // one NYC page
  let city: string | null = null;
  if (LA_Q.test(l) && cities.includes("Los Angeles")) city = "Los Angeles";
  else for (const c of cities) if (c !== "New York" && c.length > 3 && l.includes(c.toLowerCase())) { city = c; break; }
  const t = TYPE_MAP.find(([re]) => re.test(l)), x = TEXT_MAP.find(([re]) => re.test(l)), u = UNION_MAP.find(([re]) => re.test(l));
  const rules: Rules = { city, type_re: t ? t[1] : null, text_re: x ? x[1] : null, union_re: u ? u[1] : null };
  const parts = [u?.[2], t?.[2] || x?.[2]].filter(Boolean) as string[];
  // A single type or union with no city is already a built-in page (/film, /theater, /non-union...).
  if (!city && !x && (parts.length < 2)) return null;
  if (!city && !t && !x && !u) return null;
  const what = parts.length ? parts.join(" ") : "Acting";
  const label = `${what} casting calls${city ? " in " + city : ""}`;
  let title = `${what} Casting Calls${city ? " in " + city : ""} | CastSlate`;
  if (title.length > 60) title = `${what} Casting Calls | CastSlate`;
  const description = `Open ${what.toLowerCase()} casting calls${city ? " in " + city : ""}, updated daily. Create a free profile and submit to roles that fit you.`.slice(0, 155);
  return { key: slugify([city, ...parts].filter(Boolean).join(" ") || "acting").slice(0, 60), label: label.charAt(0).toUpperCase() + label.slice(1), title, description, rules };
}
// Seed searches when Search Console is unavailable: common actor searches outside NYC.
const SEED_QUERIES = ["casting calls los angeles", "student film casting los angeles", "auditions los angeles", "non union casting calls los angeles",
  "commercial casting calls los angeles", "background extras casting", "voice over auditions", "kids casting calls", "sag-aftra student film casting",
  "non union short film casting", "theater auditions los angeles", "web series casting calls"];
// Title tests without AI: honest alternative wordings, tried in turn.
const TITLE_VARIANTS = [
  (l: string) => `${l} — Apply Today | CastSlate`,
  (l: string) => `${l}: New Roles Daily | CastSlate`,
  (l: string) => `Open ${l} | CastSlate`,
];

// ── run ───────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function run(sb: any, dry = false) {
  const notes: string[] = [];
  // Real Search Console numbers when connected; otherwise a fixed list of common actor
  // searches. Title tests need real click data, so they only run with Search Console.
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
    if (week.length && !dry) {
      await sb.from("seo_page_stats").upsert(week.map((r) => ({ page: r.keys[0], week_start: day(wkStart), impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10 })), { onConflict: "page,week_start" });
    }
  } else {
    notes.push("Running without Search Console data — using common actor searches instead.");
    queries = SEED_QUERIES.map((q) => ({ keys: [q], clicks: 0, impressions: 5, ctr: 0, position: 0 }));
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
    const seen = new Set<string>();
    const ideas = cand.map((q) => ({ q: q.keys[0], i: idea(q.keys[0], cities) })).filter((x) => x.i && !seen.has(x.i.key) && seen.add(x.i.key));
    const sameRules = (a: Rules, b: Rules) => ["city", "type_re", "union_re", "text_re"].every((f) => ((a as Record<string, unknown>)[f] || null) === ((b as Record<string, unknown>)[f] || null));
    for (const { q, i: p } of ideas as { q: string; i: NonNullable<ReturnType<typeof idea>> }[]) {
      if (created.length >= MAX_NEW_PAGES) break;
      const k = p.key;
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(k) || k.length < 3 || k.length > 60 || existingKeys.has(k)) continue;
      const rules: Rules = p.rules;
      if ((existing || []).some((e: Rules) => sameRules(e, rules))) continue;
      if (rules.city && !cities.includes(rules.city)) continue;
      // NYC look-alike pages split Google's signal and pushed /casting-calls/new-york from
      // page 1 to page 4 (Sep 26 → Oct 10, 2026). New York has exactly one page; api/landing.js
      // 301s any *-nyc / new-york key to it.
      if (rules.city === "New York" || NYC_KEY.test(k)) continue;
      if ([rules.type_re, rules.union_re, rules.text_re].some((r) => r && !safeRe(r))) continue;
      if (!rules.city && !rules.type_re && !rules.union_re && !rules.text_re) continue;
      const n = live.filter((c) => matchRules(c, rules)).length;
      if (n < 3) continue;
      const title = String(p.title || "").slice(0, 70), label = String(p.label || "").slice(0, 60), desc = String(p.description || "").slice(0, 170);
      if (!title || !label || !desc) continue;
      if (dry) { created.push(k + " (dry, " + n + " live)"); existingKeys.add(k); continue; }
      const { error } = await sb.from("seo_landing_pages").insert({ key: k, label, title, description: desc, ...rules, source_query: q.slice(0, 200) });
      if (!error) { created.push(k); existingKeys.add(k); }
    }
  }

  // ── 2. retitle the agent's own pages: seen but rarely clicked ─────────────
  const retitled: string[] = [];
  const byPage = new Map(pages.map((r) => [r.keys[0].replace(/\/$/, ""), r]));
  for (const p of (dry ? [] : existing || [])) {
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
    const variants = TITLE_VARIANTS.map((f) => f(p.label)).filter((v) => v.length <= 62 && v !== p.title);
    const t = variants[(p.key.length + (p.title || "").length) % Math.max(1, variants.length)] || "";
    const d = String(p.description || "").slice(0, 170);
    if (!t || !d || t === p.title) continue;
    await sb.from("seo_landing_pages").update({ prev_title: p.title, prev_description: p.description, title: t, description: d, title_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("key", p.key);
    retitled.push(p.key);
  }

  // ── 3. tell Bing & co about new / changed pages ───────────────────────────
  const urls = [...created, ...retitled].map((k) => `${ORIGIN}/casting-calls/${k}`);
  if (urls.length && !dry) {
    await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "www.castslate.com", key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls }) }).catch(() => {});
  }
  return { notes, impressions, clicks, created, retitled, queries };
}

function esc(s: string) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function report(r: { notes: string[]; impressions: number; clicks: number; created: string[]; retitled: string[]; queries?: Row[] }) {
  if (!RESEND_API_KEY) return;
  const top = (r.queries || []).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 10);
  // Representation searches (2026-10-01): feeds the Agencies Directory FAQ. Real
  // Search Console data only — in no-key mode the queries are Gemini's guesses.
  const rep = (r.impressions || r.clicks) ? (r.queries || [])
    .filter((q) => /\b(agent|agents|agency|agencies|manager|managers|management|representation|represent)\b/i.test(q.keys[0]) && !/castslate/i.test(q.keys[0]))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 10) : [];
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;font-size:14px;color:#1A1A2E;max-width:620px">
<h2 style="margin:0 0 6px">CastSlate on Google — weekly report</h2>
${r.impressions || r.clicks ? `<p style="margin:0 0 12px">Last 28 days: <b>${r.impressions.toLocaleString()}</b> times shown in Google results, <b>${r.clicks.toLocaleString()}</b> clicks to the site.</p>` : `<p style="margin:0 0 12px">Google click numbers appear here once Search Console is connected.</p>`}
${r.created.length ? `<p style="margin:0 0 8px"><b>New pages created:</b><br/>${r.created.map((k) => `<a href="${ORIGIN}/casting-calls/${k}">${ORIGIN}/casting-calls/${k}</a>`).join("<br/>")}</p>` : `<p style="margin:0 0 8px">No new pages this week.</p>`}
${r.retitled.length ? `<p style="margin:0 0 8px"><b>Titles improved:</b> ${r.retitled.map(esc).join(", ")}</p>` : ""}
${r.notes.length ? `<p style="margin:0 0 8px;color:#8A5A12">${r.notes.map(esc).join("<br/>")}</p>` : ""}
${rep.length ? `<h3 style="margin:16px 0 6px">Actors searching about agents &amp; managers</h3><p style="margin:0 0 6px;color:#5A5A72;font-size:13px">Searches that showed CastSlate. Any question here the Agencies Directory FAQ doesn't answer yet is worth adding to it.</p><table style="border-collapse:collapse;font-size:13px">${rep.map((q) => `<tr><td style="padding:3px 12px 3px 0">${esc(q.keys[0])}</td><td style="padding:3px 8px;color:#5A5A72">${q.impressions} shown</td><td style="padding:3px 8px;color:#5A5A72">${q.clicks} clicks</td></tr>`).join("")}</table>` : ""}
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
    if (body.action !== "run" && body.action !== "dry") return json({ error: "Unknown action" }, 400);
    if (body.action === "dry") { const r = await run(sb, true); return json({ ok: true, dry: true, impressions: r.impressions, clicks: r.clicks, would_create: r.created, notes: r.notes, top_queries: (r.queries || []).slice(0, 15).map((q) => q.keys[0]) }); }
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

// events-refresh — the film events agent (2026-11-07).
//
// Every 3 days (pg_cron → run_events_auto_refresh) this:
//   1. retires events that have ended,
//   2. asks Claude (with web search) for upcoming New York film events that
//      actors would care about: festivals, screenings, panels, workshops,
//   3. keeps only events whose own page loads and names the event,
//   4. takes the page's own og:image as artwork (wide → "cover", other → "logo"),
//      or falls back to a type-only "marquee" banner,
//   5. saves them to public.film_events, which Browse Castings renders as a
//      banner after the 8th casting.
// Logos are only used to link out to the organiser's page, like News images.
//
// Auth (verify_jwt off): service-role key, the Vault news_refresh_token that
// pg_cron sends, or a signed-in admin / super_admin.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MAX_NEW = 4;
const PALETTES = ["blue", "red", "green", "navy", "plum", "amber", "teal"];
const UA = "Mozilla/5.0 (compatible; CastSlateEvents/1.0; +https://www.castslate.com)";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function nyToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

async function authorized(req: Request, sb: ReturnType<typeof createClient>): Promise<boolean> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  const { data: refreshToken } = await sb.rpc("news_get_refresh_token");
  if (typeof refreshToken === "string" && refreshToken.length > 0 && token === refreshToken) return true;
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user?.id) return false;
  const { data: prof } = await sb.from("profiles").select("user_type").eq("id", u.user.id).maybeSingle();
  return !!prof && ["admin", "super_admin"].includes((prof as { user_type: string }).user_type);
}

// Image width/height from the first bytes (PNG, JPEG, GIF, WebP).
function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b[0] === 0x52 && b[8] === 0x57) {
    if (b[12] === 0x56 && b[15] === 0x20) return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    if (b[15] === 0x4c) return { w: 1 + (b[21] | ((b[22] & 0x3f) << 8)), h: 1 + (((b[22] & 0xc0) >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
    if (b[15] === 0x58) return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

async function fetchText(url: string): Promise<{ ok: boolean; html: string; finalUrl: string }> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const html = r.ok ? (await r.text()).slice(0, 400000) : "";
    return { ok: r.ok, html, finalUrl: r.url || url };
  } catch (_) { return { ok: false, html: "", finalUrl: url }; }
}

async function artFor(pageHtml: string, pageUrl: string): Promise<{ image_url: string | null; art_style: "logo" | "cover" | "marquee" }> {
  const m = pageHtml.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::url)?["'][^>]*content=["']([^"']+)["']/i)
    || pageHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  if (!m) return { image_url: null, art_style: "marquee" };
  let img = m[1].replace(/&amp;/g, "&");
  try { img = new URL(img, pageUrl).href; } catch (_) { return { image_url: null, art_style: "marquee" }; }
  img = img.replace(/^http:\/\//i, "https://");
  try {
    const r = await fetch(img, { headers: { "User-Agent": UA, Range: "bytes=0-65535" }, signal: AbortSignal.timeout(12000) });
    if (!(r.ok || r.status === 206) || !/^image\//i.test(r.headers.get("content-type") || "")) return { image_url: null, art_style: "marquee" };
    const size = imageSize(new Uint8Array(await r.arrayBuffer()));
    if (!size || size.w < 200 || size.h < 100) return { image_url: null, art_style: "marquee" };
    // Generic site icons (square, small) say nothing about the event.
    if (size.w === size.h && size.w <= 600) return { image_url: null, art_style: "marquee" };
    return { image_url: img, art_style: size.w / size.h >= 1.6 ? "cover" : "logo" };
  } catch (_) { return { image_url: null, art_style: "marquee" }; }
}

type Found = { title: string; kicker: string; why: string; starts_on: string; ends_on: string; when_lines: [string, string][]; url: string; palette: string; marquee_word?: string };

function buildPrompt(today: string, horizon: string, known: string[]): string {
  return `Today is ${today} in New York. Find up to 8 real, upcoming film events in New York City (all five boroughs) that take place between ${today} and ${horizon}, which working and aspiring actors would find worth attending: film festivals, short film nights, screenings with filmmaker Q&As, industry panels, and acting-for-camera workshops open to the public.

Rules:
- Only include an event if you found its own official page (the festival's or organiser's site, or its official listing page) and that page states the dates. Skip anything you cannot confirm. Do not guess dates.
- Skip these, which we already have: ${known.join("; ") || "none"}.
- Skip private, invite-only, or members-only events unless they are big industry nights worth following (mark those in the kicker).
- "why" is ONE plain sentence (under 30 words) on why an actor should go. Plain everyday words, no hype, no exclamation marks.
- "kicker" is like "Documentary festival · Manhattan" or "Screening series · Brooklyn".
- "when_lines": 1 to 3 short pairs [tablerIcon, text]. Icons: calendar-event, map-pin, device-tv, trophy, ticket, users. Example: [["calendar-event","Nov 11–19"],["map-pin","IFC Center, Manhattan"]].
- "palette": one of ${PALETTES.join(", ")} that suits the event's mood or its own brand colour.
- "marquee_word": a short all-caps word or acronym (max 10 characters) for a text-only banner, e.g. "DOC NYC".

Answer with ONLY a JSON array, no other text, in this shape:
[{"title":"","kicker":"","why":"","starts_on":"YYYY-MM-DD","ends_on":"YYYY-MM-DD","when_lines":[["calendar-event",""]],"url":"https://...","palette":"","marquee_word":""}]
Return [] if you cannot confirm any.`;
}

function parseList(text: string): Found[] {
  const m = (text || "").match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const arr = JSON.parse(m[0]); return Array.isArray(arr) ? arr : []; } catch (_) { return []; }
}

// Gemini with Google Search grounding: the same key the News section uses.
async function askGemini(key: string, prompt: string): Promise<Found[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const text = (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("\n");
  return parseList(text);
}

async function askClaude(prompt: string): Promise<Found[]> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let text = "";
  for (let turn = 0; turn < 4; turn++) {
    // deno-lint-ignore no-explicit-any
    const res: any = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // deno-lint-ignore no-explicit-any
      ...({ fallbacks: "default" } as any),
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10, user_location: { type: "approximate", city: "New York", region: "New York", country: "US", timezone: "America/New_York" } }],
      messages,
    });
    if (res.stop_reason === "refusal") return [];
    text = (res.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n") || text;
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  return parseList(text);
}

async function run(sb: ReturnType<typeof createClient>) {
  const today = nyToday();
  const horizon = addDays(today, 45);
  const report: Record<string, unknown> = { today };

  // 1. Retire ended events.
  const { data: retired } = await sb.from("film_events").update({ status: "retired", updated_at: new Date().toISOString() })
    .lt("ends_on", today).neq("status", "retired").select("id");
  report.retired = retired?.length ?? 0;

  // 2. Ask the agent.
  const { data: existing } = await sb.from("film_events").select("ekey,title").gte("ends_on", today);
  const knownTitles = (existing || []).map((e: { title: string }) => e.title);
  const knownKeys = new Set((existing || []).map((e: { ekey: string }) => e.ekey));
  let found: Found[] = [];
  const prompt = buildPrompt(today, horizon, knownTitles);
  try {
    if (ANTHROPIC_API_KEY) { found = await askClaude(prompt); report.model = "claude"; }
    else {
      const { data: gk } = await sb.rpc("news_get_gemini_key");
      if (typeof gk !== "string" || !gk) throw new Error("no AI key available");
      found = await askGemini(gk, prompt); report.model = "gemini";
    }
  } catch (e) { report.agentError = String(e).slice(0, 300); }
  report.found = found.length;

  // 3–4. Verify each against its own page, add artwork, save.
  const added: string[] = [], held: string[] = [];
  for (const f of found) {
    if (added.length >= MAX_NEW) break;
    if (!f?.title || !f?.url || !/^https?:\/\//i.test(f.url)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.starts_on || "") || !/^\d{4}-\d{2}-\d{2}$/.test(f.ends_on || "")) continue;
    if (f.ends_on < today || f.starts_on > horizon || f.ends_on < f.starts_on) continue;
    const ekey = `${slug(f.title)}-${f.starts_on.slice(0, 7)}`;
    if (knownKeys.has(ekey) || knownTitles.some((t) => t.toLowerCase() === f.title.toLowerCase())) continue;
    const page = await fetchText(f.url);
    // The page must load and name the event (any 2 of its first 4 long words).
    const words = f.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 4);
    const low = page.html.toLowerCase();
    const named = words.length === 0 || words.filter((w) => low.includes(w)).length >= Math.min(2, words.length);
    const verified = page.ok && named;
    const art = verified ? await artFor(page.html, page.finalUrl) : { image_url: null, art_style: "marquee" as const };
    const row = {
      ekey, title: f.title.slice(0, 120), kicker: String(f.kicker || "Film event · New York").slice(0, 80),
      why: String(f.why || "").slice(0, 240), starts_on: f.starts_on, ends_on: f.ends_on,
      when_lines: (Array.isArray(f.when_lines) ? f.when_lines : []).slice(0, 3).map((p) => [String(p?.[0] || "calendar-event").slice(0, 30), String(p?.[1] || "").slice(0, 80)]),
      url: page.finalUrl || f.url, image_url: art.image_url, art_style: art.art_style,
      marquee_word: String(f.marquee_word || "").toUpperCase().slice(0, 10) || null,
      palette: PALETTES.includes(f.palette) ? f.palette : "navy",
      status: verified && f.why ? "published" : "review", source: "agent",
    };
    const { error } = await sb.from("film_events").insert(row);
    if (!error) { (row.status === "published" ? added : held).push(row.title); knownKeys.add(ekey); }
  }
  report.added = added; report.heldForReview = held;
  await sb.from("site_settings").update({ events_last_run: new Date().toISOString() }).eq("id", 1);
  console.log("[events-refresh]", JSON.stringify(report));
  return report;
}

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try { if (!(await authorized(req, sb))) return json({ ok: false, error: "unauthorized" }, 401); }
  catch (_) { return json({ ok: false, error: "unauthorized" }, 401); }
  const url = new URL(req.url);
  if (url.searchParams.get("wait") === "1") return json({ ok: true, ...(await run(sb)) });
  // Web search runs can take a while: answer now, keep working in the background.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(run(sb).catch((e) => console.error("[events-refresh] failed", e)));
  return json({ ok: true, started: true }, 202);
});

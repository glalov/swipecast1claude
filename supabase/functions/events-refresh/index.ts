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
// One pass = every city x type below, a few per run, so no run times out.
const SLICES_PER_RUN = 1;
const CITIES = [
  { id: "new-york", name: "New York City (all five boroughs)", sources: "Film at Lincoln Center, IFC Center, Metrograph, Anthology Film Archives, BAM, Museum of the Moving Image, The Gotham, SAGindie, Eventbrite, FilmFreeway" },
  { id: "los-angeles", name: "Los Angeles (including Hollywood, Burbank, Santa Monica, Long Beach)", sources: "Film Independent, American Cinematheque, NewFilmmakers LA, Academy Museum, Laemmle, SAGindie, Eventbrite, FilmFreeway" },
];
const CATEGORIES = [
  { id: "festival", what: "film festivals of any size" },
  { id: "shorts", what: "short film nights and short film showcases" },
  { id: "screening", what: "film screenings with a filmmaker or cast Q&A" },
  { id: "casting", what: "public panels, talks or workshops with casting directors, agents or managers" },
  { id: "workshop", what: "acting-for-camera, audition and self-tape workshops open to the public" },
  { id: "networking", what: "film industry mixers and networking nights open to actors and filmmakers" },
  { id: "union", what: "SAG-AFTRA, SAG-AFTRA Foundation or Actors' Equity events that are open to attend" },
  { id: "school", what: "film school thesis screenings and student film showcases open to the public" },
  { id: "awards", what: "film awards nights and major industry events worth following" },
];
const SLICES = CITIES.flatMap((c) => CATEGORIES.map((k) => ({ city: c, cat: k })));
// No red (owner, 2026-11-16). Each new event gets the colour used least among the city's upcoming
// events, so neighbouring cards differ. KEEP IN SYNC with EV_PALETTES in swipecast-full.jsx.
const PALETTES = ["midnight", "charcoal", "teal", "plum", "green", "amber", "blue"];
const famOf = (p: string) => (p === "navy" || p === "midnight" || p === "blue") ? "navy" : p;
function nextPalette(used: string[], last: string | null): string {
  const count = (c: string) => used.filter((u) => famOf(u) === famOf(c)).length;
  return PALETTES.filter((c) => !last || famOf(c) !== famOf(last))
    .sort((a, b) => count(a) - count(b) || PALETTES.indexOf(a) - PALETTES.indexOf(b))[0] || "midnight";
}
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

// The event's own artwork: the page's share image first, then the large images on the page.
async function artFor(pageHtml: string, pageUrl: string, gemini = ""): Promise<{ image_url: string | null; art_style: "logo" | "cover" | "marquee" }> {
  const found: string[] = [];
  for (const m of pageHtml.matchAll(/<meta[^>]+(?:og:image|twitter:image)[^>]*>/gi)) {
    const c = m[0].match(/content=["']([^"']+)/i);
    if (c) found.push(c[1]);
  }
  for (const m of pageHtml.matchAll(/<img[^>]+>/gi)) {
    const set = m[0].match(/srcset=["']([^"']+)/i);
    const last = set ? set[1].split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).pop() : null;
    const src = last || (m[0].match(/(?:data-src|data-lazy-src|src)=["']([^"']+)/i) || [])[1];
    if (src) found.push(src);
  }
  const urls = [...new Set(found.map((u) => {
    try { return new URL(u.replace(/&amp;/g, "&"), pageUrl).href.replace(/^http:\/\//i, "https://"); } catch (_) { return ""; }
  }))].filter((u) => u && !/\.(svg|gif)(\?|$)|logo|icon|sprite|spacer|pixel|badge|laurel|facebook|avatar/i.test(u)).slice(0, 16);
  const ok: { img: string; w: number; h: number }[] = [];
  for (const img of urls) {
    try {
      // No Range header: some image servers cache the partial response and then serve a cut-off image.
      const r = await fetch(img, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok || !r.body || !/^image\//i.test(r.headers.get("content-type") || "")) continue;
      const reader = r.body.getReader();
      const head = new Uint8Array(65536);
      let got = 0;
      while (got < head.length) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        head.set(value.subarray(0, head.length - got), got);
        got += value.length;
      }
      reader.cancel().catch(() => {});
      const size = imageSize(head.subarray(0, Math.min(got, head.length)));
      if (!size || size.w < 500 || size.h < 200) continue;
      if (size.w === size.h && size.w <= 600) continue;
      ok.push({ img, w: size.w, h: size.h });
      if (ok.length >= 8) break;
    } catch (_) { /* try the next image */ }
  }
  if (!ok.length) return { image_url: null, art_style: "marquee" };
  // Owner (2026-11-16): cinematic photos only, ideally with people's faces. Gemini looks at the
  // wide candidates and picks one; if it can't, keep the old rule (first usable image).
  const wide = ok.filter((c) => c.w / c.h >= 1.25 && c.w / c.h <= 2.6);
  const best = gemini && wide.length ? await pickCinematic(gemini, wide.map((c) => c.img)) : null;
  const pick = best ? ok.find((c) => c.img === best)! : ok[0];
  return { image_url: pick.img, art_style: pick.w / pick.h >= 1.25 ? "cover" : "logo" };
}

type Found = { title: string; kicker: string; why: string; starts_on: string; ends_on: string; when_lines: [string, string][]; url: string; palette: string; marquee_word?: string };

function buildPrompt(today: string, horizon: string, known: string[], city: typeof CITIES[number], cat: typeof CATEGORIES[number]): string {
  return `Today is ${today}. List as many real, upcoming ${cat.what} as you can find in ${city.name}, taking place between ${today} and ${horizon}, that working and aspiring actors or filmmakers could benefit from attending. Places worth checking include: ${city.sources}. Search more than once with different wording.

Rules:
- Only include an event if you found its own official page or official listing page, and that page states the date. Skip anything you cannot confirm. Never guess a date.
- In-person events only, at a physical venue in the city. Skip anything online, virtual, streamed, or hybrid.
- Skip these, which we already have: ${known.join("; ") || "none"}.
- For a recurring series, give one entry with the first upcoming date as starts_on and the last known date as ends_on.
- "url" must be the event's own page, as specific as possible, not a search page or a general news article.
- "why" is ONE plain sentence (under 30 words) on why an actor should go. Plain everyday words, no hype, no exclamation marks. Only say there is a Q&A or panel if the page says so.
- "kicker" is like "Documentary festival · Manhattan" or "Screening series · Burbank".
- "when_lines": 1 to 3 short pairs [tablerIcon, text]. Icons: calendar-event, map-pin, trophy, ticket, users.
- "marquee_word": a short all-caps word or acronym (max 10 characters).

Answer with ONLY a JSON array, no other text:
[{"title":"","kicker":"","why":"","starts_on":"YYYY-MM-DD","ends_on":"YYYY-MM-DD","when_lines":[["calendar-event",""]],"url":"https://...","marquee_word":""}]
Return [] if you cannot confirm any.`;
}

function parseList(text: string): Found[] {
  const m = (text || "").match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const arr = JSON.parse(m[0]); return Array.isArray(arr) ? arr : []; } catch (_) { return []; }
}

// Gemini with Google Search grounding: the same key the News section uses.
// Google retires model versions, so pick the newest stable "gemini-X-flash" this key can use.
async function geminiModel(key: string): Promise<string> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    const names = (d?.models || [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) => /^models\/gemini-\d+(\.\d+)?-flash$/.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""));
    const ver = (n: string) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
    names.sort((x: string, y: string) => ver(y) - ver(x));
    if (names[0]) return names[0];
  } catch (_) { /* fall through */ }
  return "gemini-flash-latest";
}

// Looks at the actual image. Posters, banners and anything with words get shown whole on the
// site; only plain photos may be cropped to fill the frame. null means the check itself failed.
// Shows Gemini up to 6 candidate images and asks for the most cinematic real photograph,
// preferring visible faces. Returns null when none qualifies or the check fails.
async function pickCinematic(key: string, imgs: string[]): Promise<string | null> {
  try {
    const parts: Record<string, unknown>[] = [];
    const kept: string[] = [];
    for (const img of imgs.slice(0, 6)) {
      try {
        const r = await fetch(img, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
        const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!r.ok || !["image/jpeg", "image/png", "image/webp"].includes(mime)) continue;
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > 3000000) continue;
        let bin = "";
        for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
        parts.push({ text: `Image ${kept.length}:` }, { inline_data: { mime_type: mime, data: btoa(bin) } });
        kept.push(img);
      } catch (_) { /* skip this one */ }
    }
    if (!kept.length) return null;
    const prompt = 'These images come from a film event\'s website. Pick the ONE that looks most cinematic: a real film still or a real photograph of people (on stage, on set, at the event), ideally with faces clearly visible. Never pick a poster, a logo, a flyer, an image with designed text or dates, a screenshot, a building, or an empty room. If none qualifies, answer -1. Reply with only JSON: {"best": <number>}.';
    const model = await geminiModel(key);
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }], generationConfig: { temperature: 0 } }),
      signal: AbortSignal.timeout(60000),
    });
    if (!g.ok) return null;
    const d = await g.json();
    const out = (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join(" ");
    const m = out.match(/"best"\s*:\s*(-?\d+)/);
    const i = m ? parseInt(m[1], 10) : -1;
    return i >= 0 && i < kept.length ? kept[i] : null;
  } catch (_) { return null; }
}

async function hasTextArt(key: string, model: string, img: string): Promise<boolean | null> {
  try {
    const r = await fetch(img, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!r.ok || !["image/jpeg", "image/png", "image/webp"].includes(mime)) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > 4000000) return null;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const prompt = 'This image goes in a wide frame and may have its edges cropped. Does it have words, a title, a logo or dates designed into it, or is it a designed poster or graphic? Words that are simply part of a real scene in a photograph, like a theatre sign, do not count. Ordinary film stills and photographs are false. Reply with only JSON: {"text":true} or {"text":false}.';
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: btoa(bin) } }] }], generationConfig: { temperature: 0 } }),
      signal: AbortSignal.timeout(45000),
    });
    if (!g.ok) return null;
    const d = await g.json();
    const out = (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join(" ");
    const m = out.match(/"text"\s*:\s*(true|false)/i);
    return m ? m[1].toLowerCase() === "true" : null;
  } catch (_) { return null; }
}

async function askGemini(key: string, prompt: string): Promise<Found[]> {
  const model = await geminiModel(key);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
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

const normUrl = (u: string) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase(); } catch (_) { return String(u || "").toLowerCase(); } };
const normTitle = (t: string) => t.toLowerCase().replace(/\b(19|20)\d{2}\b|\b\d+(st|nd|rd|th)\b|\bannual\b|\bthe\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// The page must state the event's start date: its month plus day, or a numeric date.
function pageHasDate(low: string, iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const name = MONTHS[m - 1], ab = name.slice(0, 3);
  if (new RegExp(`\\b(${name}|${ab})\\.?\\s+${d}(st|nd|rd|th)?\\b`).test(low)) return true;
  if (new RegExp(`\\b${d}(st|nd|rd|th)?\\s+(of\\s+)?(${name}|${ab})\\b`).test(low)) return true;
  const mm = String(m).padStart(2, "0"), dd = String(d).padStart(2, "0");
  return low.includes(`${y}-${mm}-${dd}`) || new RegExp(`\\b0?${m}[/.]0?${d}([/.]|\\b)`).test(low);
}

async function run(sb: ReturnType<typeof createClient>) {
  const today = nyToday();
  const horizon = addDays(today, 60);
  const report: Record<string, unknown> = { today };

  const { data: retired } = await sb.from("film_events").update({ status: "retired", updated_at: new Date().toISOString() })
    .lt("ends_on", today.slice(0, 7) + "-01").neq("status", "retired").select("id"); // finished events stay listed until the month ends
  report.retired = retired?.length ?? 0;

  const { data: st } = await sb.from("site_settings").select("events_slice").eq("id", 1).maybeSingle();
  const start = Math.max(0, Number((st as { events_slice?: number } | null)?.events_slice) || 0) % SLICES.length;
  const { data: existing } = await sb.from("film_events").select("ekey,title,url,city,palette").gte("ends_on", today);
  const rows = (existing || []) as { ekey: string; title: string; url: string; city: string; palette?: string }[];
  const lastPal: Record<string, string | null> = {};
  const knownKeys = new Set(rows.map((e) => e.ekey));
  const knownUrls = new Set(rows.map((e) => normUrl(e.url)));
  const knownNames = new Set(rows.map((e) => normTitle(e.title)));
  let gemini = "";
  if (!ANTHROPIC_API_KEY) { const { data: gk } = await sb.rpc("news_get_gemini_key"); gemini = typeof gk === "string" ? gk : ""; }

  const added: string[] = [], held: string[] = [], errors: string[] = [];
  let found = 0;
  const count = Math.min(SLICES_PER_RUN, SLICES.length - start);
  // Move the cursor first: a run cut off by the time limit must not repeat the same search forever.
  const next = start + count;
  const done = next >= SLICES.length;
  await sb.from("site_settings").update(done ? { events_slice: 0, events_last_run: new Date().toISOString() } : { events_slice: next }).eq("id", 1);
  for (let n = 0; n < count; n++) {
    const { city, cat } = SLICES[start + n];
    const known = rows.filter((e) => e.city === city.id).map((e) => e.title).slice(0, 120);
    const prompt = buildPrompt(today, horizon, known, city, cat);
    let list: Found[] = [];
    try { list = ANTHROPIC_API_KEY ? await askClaude(prompt) : await askGemini(gemini, prompt); }
    catch (e) { errors.push(`${city.id}/${cat.id}: ${String(e).slice(0, 160)}`); continue; }
    found += list.length;
    const pages = new Map<string, Awaited<ReturnType<typeof fetchText>>>();
    await Promise.all([...new Set(list.map((f) => f?.url).filter((u) => /^https?:\/\//i.test(u || "")))].map(async (u) => { pages.set(u, await fetchText(u)); }));
    for (const f of list) {
      if (!f?.title || !f?.url || !/^https?:\/\//i.test(f.url)) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.starts_on || "") || !/^\d{4}-\d{2}-\d{2}$/.test(f.ends_on || "")) continue;
      if (f.ends_on < today || f.starts_on > horizon || f.ends_on < f.starts_on) continue;
      const ekey = `${slug(f.title)}-${f.starts_on.slice(0, 7)}`;
      if (knownKeys.has(ekey) || knownUrls.has(normUrl(f.url)) || knownNames.has(normTitle(f.title))) continue;
      const page = pages.get(f.url) || await fetchText(f.url);
      const words = f.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 4);
      const low = page.html.toLowerCase();
      const named = words.length === 0 || words.filter((w) => low.includes(w)).length >= Math.min(2, words.length);
      const verified = page.ok && named && pageHasDate(low, f.starts_on);
      const art = verified ? await artFor(page.html, page.finalUrl, gemini) : { image_url: null, art_style: "marquee" as const };
      // If the check fails, show the image whole: an uncropped image is always the safe choice.
      const artText = art.image_url && gemini ? await hasTextArt(gemini, await geminiModel(gemini), art.image_url) : null;
      const row = {
        ekey, title: f.title.slice(0, 120), kicker: String(f.kicker || "Film event").slice(0, 80),
        why: String(f.why || "").slice(0, 240), starts_on: f.starts_on, ends_on: f.ends_on,
        when_lines: (Array.isArray(f.when_lines) ? f.when_lines : []).slice(0, 3).map((p) => [String(p?.[0] || "calendar-event").slice(0, 30), String(p?.[1] || "").slice(0, 80)]),
        url: page.finalUrl || f.url, image_url: art.image_url, art_style: art.art_style,
        art: art.image_url && gemini ? { whole: artText !== false, checked: artText !== null } : null,
        marquee_word: String(f.marquee_word || "").toUpperCase().slice(0, 10) || null,
        palette: nextPalette(rows.filter((e) => e.city === city.id).map((e) => e.palette || ""), lastPal[city.id] || null),
        status: verified && f.why && !/\b(hybrid event|via zoom|on zoom|online only|virtual event|webinar)\b/i.test(page.html) ? "published" : "review", source: "agent", city: city.id, category: cat.id,
      };
      const { error } = await sb.from("film_events").insert(row);
      if (!error) {
        (row.status === "published" ? added : held).push(`${city.id}: ${row.title}`);
        knownKeys.add(ekey); knownUrls.add(normUrl(f.url)); knownUrls.add(normUrl(row.url)); knownNames.add(normTitle(f.title));
        rows.push({ ekey, title: row.title, url: row.url, city: city.id, palette: row.palette });
        lastPal[city.id] = row.palette;
      }
    }
  }
  Object.assign(report, { slices: `${start}-${next}/${SLICES.length}`, found, added, heldForReview: held, errors });
  console.log("[events-refresh]", JSON.stringify(report));
  return report;
}

// Backfill for events saved before the image check existed. Only touches images not checked yet.
async function artCheck(sb: ReturnType<typeof createClient>) {
  const { data: gk } = await sb.rpc("news_get_gemini_key");
  const key = typeof gk === "string" ? gk : "";
  if (!key) return { error: "no key" };
  const model = await geminiModel(key);
  const { data } = await sb.from("film_events").select("id,title,image_url,art").eq("status", "published").gte("ends_on", nyToday().slice(0, 7) + "-01").not("image_url", "is", null);
  const rows = ((data || []) as { id: string; title: string; image_url: string; art: Record<string, unknown> | null }[]).filter((e) => !e.art?.row && !e.art?.logo && !e.art?.checked);
  const whole: string[] = [], photo: string[] = [], failed: string[] = [];
  for (let i = 0; i < rows.length; i += 4) {
    await Promise.all(rows.slice(i, i + 4).map(async (e) => {
      const t = await hasTextArt(key, model, e.image_url);
      if (t === null) { failed.push(e.title); return; }
      (t ? whole : photo).push(e.title);
      await sb.from("film_events").update({ art: { ...(e.art || {}), whole: t, checked: true } }).eq("id", e.id);
    }));
  }
  return { whole, photo, failed };
}

// Dashboard Industry Events card header (owner, 2026-11-17, demo on the talent dashboard).
// Once a month, look at this month's event photos and keep ONE that survives a wide crop:
// shape check first (wide, sharp), then Gemini looks at it (real photo or film still, no
// designed text/logo/poster, a clearly visible face inside a ~2.2:1 strip), gives the focus
// point and a face score; the best face wins. Re-picks when the chosen event ends (2026-11-25).
// The winner is COPIED into our own storage so the card never hotlinks or breaks.
// Nothing passes -> url null, and the card shows the owner's licensed marquee photo.
async function cardPick(sb: ReturnType<typeof createClient>, force: boolean) {
  const month = nyToday().slice(0, 7);
  const { data: ss } = await sb.from("site_settings").select("events_card_art").eq("id", 1).maybeSingle();
  const cur = (ss as { events_card_art?: { month?: string; event_id?: string } } | null)?.events_card_art;
  // Owner 2026-11-25: keep this month's photo only while its event is still ahead. Once that
  // event ends (or is unpublished), pick again from what's still coming this month.
  if (!force && cur?.month === month) {
    if (!cur.event_id) return { skipped: "already picked this month", current: cur };
    const { data: ev } = await sb.from("film_events").select("ends_on,status").eq("id", cur.event_id).maybeSingle();
    const evr = ev as { ends_on?: string; status?: string } | null;
    if (evr && evr.status === "published" && String(evr.ends_on || "") >= nyToday()) return { skipped: "current pick still upcoming", current: cur };
  }
  const { data: gk } = await sb.rpc("news_get_gemini_key");
  const key = typeof gk === "string" ? gk : "";
  if (!key) return { error: "no key" };
  const model = await geminiModel(key);
  const today = nyToday();
  const [yy, mm] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10); // real last day ("2026-11-31" is not a date)
  const { data, error: qErr } = await sb.from("film_events").select("id,title,image_url,starts_on,ends_on,featured_rank")
    .eq("status", "published").gte("ends_on", today).lte("starts_on", monthEnd).not("image_url", "is", null);
  if (qErr) return { error: "events query failed: " + qErr.message }; // never record "none" on a failed read
  const rows = ((data || []) as { id: string; title: string; image_url: string; starts_on: string; featured_rank: number | null }[])
    .sort((a, b) => ((a.featured_rank ?? 99) - (b.featured_rank ?? 99)) || String(a.starts_on).localeCompare(String(b.starts_on)));
  const tried: string[] = [];
  const prompt = 'This image will be the header of a small card on a website. It will be cropped to a wide strip about 2.2 times wider than it is tall, with a white title over the bottom-left. Say ok:true ONLY if ALL of these hold: it is a real photograph or a film still (NOT a poster, flyer, logo, banner, graphic, collage, illustration or screenshot); it has NO designed text, titles, logos or dates in it; it is not mostly blank or one flat colour; and its main subject stays fully inside a 2.2:1 crop; AND it shows at least one person whose face is clearly visible, facing the camera or in profile, and large enough to read on a small card (NOT crowds seen from behind, NOT tiny faces in the distance, NOT empty venues, screens, streets or objects). Also give the point the crop should centre on, as percentages from the left (x) and top (y), and a "face" score from 1 to 10 for how large, clear and appealing the main face is. Reply with only JSON: {"ok":true,"x":50,"y":40,"face":7} or {"ok":false}.';
  // Owner 2026-11-25: faces required, and the strongest face wins. Look at every candidate,
  // keep the passes, then copy only the winner into storage.
  const passed: { e: { id: string; title: string }; bytes: Uint8Array; mime: string; pos: string; face: number }[] = [];
  const t0 = Date.now();
  for (const e of rows.slice(0, 25)) {
    // Every candidate now gets a vision call (no stop at the first pass), so stay well inside the
    // edge wall clock, and stop early once an excellent face is in hand.
    if (Date.now() - t0 > 90000 || passed.some((x) => x.face >= 9)) break;
    try {
      const r = await fetch(e.image_url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!r.ok || !["image/jpeg", "image/webp", "image/png"].includes(mime)) { tried.push(e.title + ": bad file"); continue; }
      const bytes = new Uint8Array(await r.arrayBuffer());
      const sz = imageSize(bytes);
      if (!sz || sz.w < 1000 || sz.w / sz.h < 1.6 || bytes.length > 4000000) { tried.push(e.title + ": shape " + (sz ? sz.w + "x" + sz.h : "?")); continue; }
      let bin = "";
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: btoa(bin) } }] }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(45000),
      });
      if (!g.ok) { tried.push(e.title + ": vision error"); continue; }
      const d = await g.json();
      const out = (d?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join(" ");
      if (!/"ok"\s*:\s*true/i.test(out)) { tried.push(e.title + ": rejected"); continue; }
      const num = (k: string, def: number) => { const m = out.match(new RegExp('"' + k + '"\\s*:\\s*(\\d+(?:\\.\\d+)?)')); const v = m ? parseFloat(m[1]) : def; return Math.max(0, Math.min(100, Math.round(v))); };
      const pos = `${num("x", 50)}% ${num("y", 40)}%`;
      passed.push({ e, bytes, mime, pos, face: num("face", 5) });
      passed.sort((a, b) => b.face - a.face); // stable: equal faces keep featured_rank / date order
      passed.length = Math.min(passed.length, 3); // hold at most 3 images in memory
    } catch (_) { tried.push(e.title + ": error"); }
  }
  for (const { e, bytes, mime, pos, face } of passed) {
    try {
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const path = `events-card/${month}-${slug(e.title)}.${ext}`;
      const up = await sb.storage.from("news-media").upload(path, bytes, { contentType: mime, upsert: true, cacheControl: "31536000" });
      if (up.error) { tried.push(e.title + ": upload failed"); continue; }
      const url = sb.storage.from("news-media").getPublicUrl(path).data.publicUrl;
      const art = { month, url, pos, face, event_id: e.id, title: e.title, picked_at: new Date().toISOString() };
      await sb.from("site_settings").update({ events_card_art: art }).eq("id", 1);
      return { picked: art, tried, passed: passed.map((x) => x.e.title + " (" + x.face + ")") };
    } catch (_) { tried.push(e.title + ": upload error"); }
  }
  const none = { month, url: null, none: true, picked_at: new Date().toISOString() };
  await sb.from("site_settings").update({ events_card_art: none }).eq("id", 1);
  return { picked: null, tried };
}

// Daily sold-out sweep (owner, 2026-11-08). One-day events only: a festival with one sold-out
// showing is still worth listing. Listing pages are skipped, since "sold out" there can be
// about a different event.
async function soldOutCheck(sb: ReturnType<typeof createClient>) {
  const { data } = await sb.from("film_events").select("id,title,url,starts_on,ends_on")
    .eq("status", "published").gte("ends_on", nyToday());
  const rows = ((data || []) as { id: string; title: string; url: string; starts_on: string; ends_on: string }[])
    .filter((e) => e.starts_on === e.ends_on && !/\/(events?|calendar)\/?$/i.test(new URL(e.url).pathname) && new URL(e.url).pathname !== "/");
  const soldOut: string[] = [];
  for (let i = 0; i < rows.length; i += 6) {
    await Promise.all(rows.slice(i, i + 6).map(async (e) => {
      const page = await fetchText(e.url);
      if (!page.ok) return;
      const text = page.html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
      if (!/\bsold[\s-]?out\b/i.test(text)) return;
      await sb.from("film_events").update({ status: "sold_out", updated_at: new Date().toISOString() }).eq("id", e.id);
      soldOut.push(e.title);
    }));
  }
  return { checked: rows.length, soldOut };
}

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try { if (!(await authorized(req, sb))) return json({ ok: false, error: "unauthorized" }, 401); }
  catch (_) { return json({ ok: false, error: "unauthorized" }, 401); }
  const url = new URL(req.url);
  if (url.searchParams.get("mode") === "artcheck") return json({ ok: true, ...(await artCheck(sb)) });
  if (url.searchParams.get("mode") === "cardpick") return json({ ok: true, ...(await cardPick(sb, url.searchParams.get("force") === "1")) });
  if (url.searchParams.get("mode") === "soldout") {
    if (url.searchParams.get("wait") === "1") return json({ ok: true, ...(await soldOutCheck(sb)) });
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil(soldOutCheck(sb).catch((e) => console.error("[events-refresh] soldout failed", e)));
    return json({ ok: true, started: true }, 202);
  }
  if (url.searchParams.get("wait") === "1") return json({ ok: true, ...(await run(sb)) });
  // Web search runs can take a while: answer now, keep working in the background.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(run(sb).catch((e) => console.error("[events-refresh] failed", e)));
  return json({ ok: true, started: true }, 202);
});

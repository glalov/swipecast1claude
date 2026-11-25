// events-refresh — the film events agent.
//
// Since 2026-11-25 it uses NO AI (owner: tight budget, Gemini credits ran out). Hourly
// (pg_cron → run_events_auto_refresh, ~3-day gate) it reads ONE source per run: venue event
// feeds/calendars (American Cinematheque, NewFilmmakers LA, Laemmle Q&As, IFC Center, Roxy,
// SVA Theatre, Film Forum, Symphony Space) and Eventbrite searches for NYC and LA. Dates, links
// and descriptions come from the organiser's own pages; keyword rules keep events with a live
// element (Q&A, panel, premiere, festival, workshop, mixer) and skip online/off-topic ones.
// cardpick / artcheck still call Gemini when a funded key exists, and simply do nothing otherwise.
//
// Auth (verify_jwt off): service-role key, the Vault news_refresh_token that
// pg_cron sends, or a signed-in admin / super_admin.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

// Gemini (only cardpick/artcheck use it now): the same key the News section uses.
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

// ── No-AI event finder (owner, 2026-11-25: "make it work without Gemini, find as much as now") ──
// Reads venue calendars and Eventbrite searches directly. Every date, link and description comes
// from the organiser's own page, so nothing is guessed. One source per hourly cron run (a full pass
// takes about as many hours as there are sources), gated to repeat every ~3 days by
// run_events_auto_refresh. Costs nothing: no AI calls anywhere in this path.

type Cand = {
  title: string; url: string; city: string; venue: string; area: string; marquee: string;
  dates: string[]; time?: string; desc?: string; image?: string | null; online?: boolean; tags?: string;
};
type Source = { id: string; city: string; run: (ctx: Ctx) => Promise<Cand[]> };
type Ctx = { today: string; horizon: string; log: string[] };

const NY = "new-york", LA = "los-angeles";
const MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Worth an actor's evening: a live element (Q&A, talk, panel), a festival or showcase, or a class.
const RELEVANT = /\bq\s*(?:&|&amp;|and)\s*a\b|in[- ]person|conversation with|in conversation|discussion|panel|talkback|premiere|sneak|festival|fest\b|showcase|shorts? (?:program|night|showcase)|short films|workshop|master ?class|seminar|networking|mixer|meet[- ]?up|filmmakers? (?:in attendance|will)|director(?:s)? (?:in attendance|will|present)|cast (?:in attendance|will)|introduc(?:ed|tion) by|student (?:film|screening)|thesis|awards?\b|casting director|audition/i;
const SKIP = /\bvirtual\b|\bonline\b|live ?stream|\bzoom\b|webinar|comedy|stand[- ]?up|concert|\bdj\b|party\b|brunch|yoga|crawl|singles|dating|sneaker|crypto|real estate|startup|wine|trivia|karaoke|drag brunch|bingo/i;
const FILMY = /film|cinema|movie|screening|festival|actor|acting|audition|casting|filmmaker|short|documentary|doc\b|showcase|director|screenwrit|theatre|theater/i;

const clean = (s: string) => String(s || "")
  .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?38;/g, "&").replace(/&#8211;|&ndash;/g, "–")
  .replace(/&#8212;|&mdash;/g, "—").replace(/&#8217;|&rsquo;|&#x27;|&#39;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
  .replace(/&nbsp;/g, " ").replace(/&#[0-9]+;/g, "").replace(/\s+/g, " ").trim();
const meta = (h: string, prop: string) => {
  const m = h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"));
  const c = m && m[0].match(/content=["']([^"']*)/i);
  return c ? clean(c[1]) : "";
};
const absUrl = (u: string, base: string) => { try { return new URL(u.replace(/&amp;/g, "&"), base).href; } catch (_) { return ""; } };

// JSON-LD events on a page (Event, ScreeningEvent, Festival, TheaterEvent, ...).
function ldEvents(h: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    const t = ([] as unknown[]).concat(r["@type"] ?? []);
    if (t.some((x) => typeof x === "string" && (/Event$/.test(x) || x === "Festival"))) out.push(r);
    Object.values(r).forEach((v) => { if (v && typeof v === "object") walk(v); });
  };
  for (const m of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch (_) { /* skip broken blocks */ }
  }
  return out;
}

// Dates written in text ("Thu Dec 17", "December 5, 2026", "12/05/2026"). A date without a year
// takes this year, or next year when it would otherwise be more than 2 months in the past.
function textDates(text: string, today: string): string[] {
  const out = new Set<string>();
  const ty = Number(today.slice(0, 4));
  const add = (y: number | null, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    let yy = y ?? ty;
    let iso = `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (y === null && iso < addDays(today, -60)) { yy++; iso = `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
    if (!isNaN(Date.parse(iso + "T12:00:00Z"))) out.add(iso);
  };
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?(?:,?\s+(20\d{2}))?\b/gi;
  for (const m of text.matchAll(re)) add(m[3] ? Number(m[3]) : null, MON3.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]));
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/g)) add(Number(m[3].length === 2 ? "20" + m[3] : m[3]), Number(m[1]), Number(m[2]));
  return [...out].sort();
}
const timeIn = (text: string) => (text.match(/\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i) || [])[1]?.toUpperCase().replace(/\s/g, " ") || undefined;

function fmtWhen(dates: string[], time?: string): string {
  const f = (iso: string, y = false) => {
    const d = new Date(iso + "T12:00:00Z");
    return `${WEEKDAY[d.getUTCDay()]}, ${MON3[d.getUTCMonth()][0].toUpperCase() + MON3[d.getUTCMonth()].slice(1)} ${d.getUTCDate()}${y ? ", " + d.getUTCFullYear() : ""}`;
  };
  if (!dates.length) return "";
  if (dates.length === 1) return f(dates[0], true) + (time ? " · " + time : "");
  const a = dates[0], b = dates[dates.length - 1];
  if (dates.length === 2) return `${f(a)} & ${f(b, true)}`;
  return `${f(a)} – ${f(b, true)}`;
}

// Detail page → candidate. JSON-LD first (exact dates), then the page's own share text.
async function detail(url: string, base: Omit<Cand, "title" | "url" | "dates">, ctx: Ctx, opts: { titleOverride?: string; datesFrom?: "og" | "page" | "ld" } = {}): Promise<(Cand & { html: string; finalUrl: string }) | null> {
  const p = await fetchText(url);
  if (!p.ok || !p.html) return null;
  const h = p.html;
  const ld = ldEvents(h).filter((e) => typeof e.startDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(String(e.startDate)));
  const ogTitle = meta(h, "og:title").replace(/\s*[|–—-]\s*(?:Showtimes.*|IFC Center|American Cinematheque|Laemmle.*|Roxy Cinema.*|SVA Theatre.*|Eventbrite|Symphony Space.*|Film Forum)\s*$/i, "").replace(/^IFC Center\s*-\s*/i, "").replace(/^Film Forum\s*·\s*/i, "");
  const desc = meta(h, "og:description") || meta(h, "description");
  let dates: string[] = [], time: string | undefined, online = false, image: string | null = null, venue = base.venue, area = base.area;
  if (ld.length && opts.datesFrom !== "og") {
    dates = [...new Set(ld.map((e) => String(e.startDate).slice(0, 10)))].sort();
    const end = ld.map((e) => String(e.endDate || "").slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().pop();
    if (end && dates.length === 1 && end > dates[0] && end <= addDays(dates[0], 14)) dates.push(end);
    const t = String(ld[0].startDate).match(/T(\d{2}):(\d{2})/);
    if (t && !(t[1] === "00" && t[2] === "00")) { const hh = Number(t[1]); time = `${((hh + 11) % 12) + 1}:${t[2]} ${hh >= 12 ? "PM" : "AM"}`; }
    online = ld.some((e) => /Online/i.test(String(e.eventAttendanceMode || "")) && !/Mixed/i.test(String(e.eventAttendanceMode || "")));
    const loc = ld[0].location as Record<string, unknown> | undefined;
    if (loc && typeof loc === "object") {
      if (typeof loc.name === "string" && loc.name.length < 70) venue = clean(loc.name);
      const addr = loc.address as Record<string, unknown> | undefined;
      if (addr && typeof addr === "object" && typeof addr.addressLocality === "string") area = clean(addr.addressLocality);
    }
    const img = ([] as unknown[]).concat(ld[0].image ?? [])[0];
    if (typeof img === "string") image = absUrl(img, p.finalUrl);
  } else {
    const text = opts.datesFrom === "page" ? clean(h).slice(0, 60000) : desc;
    dates = textDates(text, ctx.today);
    time = timeIn(text);
  }
  dates = dates.filter((d) => d >= ctx.today && d <= ctx.horizon);
  const title = clean(opts.titleOverride || ogTitle || String(ld[0]?.name || ""));
  if (!image) image = meta(h, "og:image") ? absUrl(meta(h, "og:image"), p.finalUrl) : null;
  return { ...base, title, url: p.finalUrl || url, dates, time, desc, image, online, venue, area, html: h, finalUrl: p.finalUrl };
}

async function links(listUrl: string, re: RegExp, max: number): Promise<string[]> {
  const p = await fetchText(listUrl);
  if (!p.ok) return [];
  const out: string[] = [];
  for (const m of p.html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const u = absUrl(m[1], p.finalUrl).replace(/\?.*$/, "");
    if (re.test(u) && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(f)));
  return out;
}

// ── Sources ──
const SOURCES: Source[] = [
  // American Cinematheque (Egyptian, Aero, Los Feliz): its own event feed, tagged Q&A / Premiere /
  // Panel / Sneak / Shorts / Lecture. The link carries the date (…-12-11-2026/).
  { id: "american-cinematheque", city: LA, run: async (ctx) => {
    const TYPES = "62,101,169,191,133,99,118,120,196"; // Q&A, Panel, Premiere, Advance, Sneak x3, Shorts, Lecture
    const AREA: Record<number, [string, string]> = { 54: ["Aero Theatre", "Santa Monica"], 55: ["Egyptian Theatre", "Hollywood"], 102: ["Los Feliz Theatre", "Los Feliz"], 342: ["The Culver Theater", "Culver City"] };
    const out: Cand[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await fetch(`https://www.americancinematheque.com/wp-json/wp/v2/event?event_type=${TYPES}&per_page=100&page=${page}&_fields=link,title,event_type,event_location,yoast_head_json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!r || !r.ok) break;
      const arr = await r.json().catch(() => []) as Record<string, unknown>[];
      for (const e of arr) {
        const link = String(e.link || "");
        const m = link.match(/-(\d{2})-(\d{2})-(\d{4})\/?$/);
        if (!m) continue;
        const iso = `${m[3]}-${m[1]}-${m[2]}`;
        if (iso < ctx.today || iso > ctx.horizon) continue;
        const locs = (e.event_location as number[]) || [];
        if (locs.includes(59)) continue; // Virtual
        const [venue, area] = AREA[locs.find((l) => AREA[l]) ?? 0] || ["American Cinematheque", "Los Angeles"];
        const y = (e.yoast_head_json || {}) as Record<string, unknown>;
        const img = ((y.og_image as { url?: string }[]) || [])[0]?.url || null;
        const types = ((e.event_type as number[]) || []);
        const tags = [types.includes(62) ? "Q&A" : "", types.includes(169) ? "premiere" : "", types.includes(101) ? "panel" : "", types.includes(120) ? "shorts" : "", types.some((t) => [191, 133, 99, 118].includes(t)) ? "sneak preview" : "", types.includes(196) ? "talk" : ""].filter(Boolean).join(" ");
        out.push({ title: clean((e.title as { rendered?: string })?.rendered || ""), url: link, city: LA, venue, area, marquee: "CINEMATHEQUE", dates: [iso], desc: clean(String(y.og_description || y.description || "")) || (types.includes(62) ? "Screening followed by a Q&A with the filmmakers." : types.includes(101) ? "Screening with a panel conversation." : types.includes(169) ? "Premiere screening at the American Cinematheque." : ""), image: img, tags });
      }
      if (arr.length < 100) break;
    }
    return out;
  } },
  // NewFilmmakers LA: its event feed; the title starts with the date.
  { id: "nfmla", city: LA, run: async (ctx) => {
    const r = await fetch("https://www.newfilmmakersla.com/wp-json/wp/v2/event?per_page=40&_fields=link,title,acf,yoast_head_json", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!r || !r.ok) return [];
    const arr = await r.json().catch(() => []) as Record<string, unknown>[];
    return arr.map((e) => {
      const raw = clean((e.title as { rendered?: string })?.rendered || "");
      const alt = clean(String((e.acf as Record<string, unknown>)?.event_alternative_name || ""));
      const y = (e.yoast_head_json || {}) as Record<string, unknown>;
      return { title: alt || raw.replace(/^[A-Za-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}\s*[–-]\s*/, ""), url: String(e.link || ""), city: LA, venue: "NewFilmmakers LA", area: "Downtown LA", marquee: "NFMLA",
        dates: textDates(raw, ctx.today).filter((d) => d >= ctx.today && d <= ctx.horizon), desc: clean(String(y.og_description || "")), image: ((y.og_image as { url?: string }[]) || [])[0]?.url || null, tags: "festival screening Q&A" };
    }).filter((c) => c.dates.length);
  } },
  // Laemmle: its own "Q&As / Events" page lists the films with a live element.
  { id: "laemmle", city: LA, run: async (ctx) => {
    const urls = await links("https://www.laemmle.com/qa-events", /laemmle\.com\/film\/[a-z0-9-]+$/i, 25);
    const got = await pool(urls, 5, (u) => detail(u, { city: LA, venue: "Laemmle Theatres", area: "Los Angeles", marquee: "LAEMMLE", tags: "Q&A" }, ctx, { datesFrom: "page" }));
    // Each film page has an exact line: "Q&A In Person Mon, Nov 30 · 7:15 PM · Glendale".
    const out: Cand[] = [];
    for (const c of got) {
      if (!c) continue;
      const text = clean(c.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
      const hits = [...text.matchAll(/(Q&A|Panel|Discussion|Conversation|Introduction|In Person)[^·]{0,40}?((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}) · (\d{1,2}:\d{2} [AP]M) · ([A-Za-z .'-]{3,40}?)(?= [A-Z][a-z]|$)/g)];
      const dates = [...new Set(hits.flatMap((m) => textDates(m[2], ctx.today)))].filter((d) => d >= ctx.today && d <= ctx.horizon).sort();
      if (!dates.length) continue;
      const theatre = hits[0][4].trim();
      out.push({ ...c, dates: dates.slice(0, 3), time: dates.length === 1 ? hits[0][3] : undefined, venue: (/^Monica/.test(theatre) ? "Laemmle Monica Film Center" : `Laemmle ${theatre}`).replace(/Laemmle Laemmle/, "Laemmle"), area: /^Monica/.test(theatre) ? "Santa Monica" : theatre === "NoHo 7" ? "North Hollywood" : theatre === "Town Center 5" ? "Encino" : theatre === "Newhall" ? "Santa Clarita" : theatre === "Royal" ? "West LA" : theatre });
    }
    return out;
  } },
  // IFC Center: each film page's share text opens with the special date ("Thu Dec 17: Sneak preview + Q&A …").
  { id: "ifc-center", city: NY, run: async (ctx) => {
    const urls = await links("https://www.ifccenter.com/", /ifccenter\.com\/films\/[a-z0-9-]+\/?$/i, 45);
    const got = await pool(urls, 6, (u) => detail(u, { city: NY, venue: "IFC Center", area: "Greenwich Village", marquee: "IFC" }, ctx, { datesFrom: "og" }));
    return got.filter((c) => c && RELEVANT.test(c.desc || "")) as Cand[];
  } },
  // SVA Theatre: festivals and showcases rent the house; keep the film ones.
  { id: "sva-theatre", city: NY, run: async (ctx) => {
    const urls = await links("https://svatheatre.com/events/", /svatheatre\.com\/events\/[a-z0-9-]+\/?$/i, 40);
    const got = await pool(urls, 5, (u) => detail(u, { city: NY, venue: "SVA Theatre", area: "Chelsea", marquee: "SVA" }, ctx, { datesFrom: "page" }));
    return got.filter((c) => c && FILMY.test(c.title + " " + (c.desc || ""))).map((c) => ({ ...c!, dates: c!.dates.slice(0, 3) }));
  } },
  // Film Forum: its "Upcoming Events" box lists every guest appearance with the exact day and time.
  { id: "film-forum", city: NY, run: async (ctx) => {
    const p = await fetchText("https://filmforum.org/");
    if (!p.ok) return [];
    const box = p.html.slice(p.html.indexOf("Upcoming Events"), p.html.indexOf("Get Email News"));
    const out: Cand[] = [];
    for (const m of box.matchAll(/<h5[^>]*>\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h5>[\s\S]*?<p>([\s\S]*?)<\/p>/g)) {
      const [film, guest = ""] = m[2].split(/<br\s*\/?>/i).map(clean);
      const when = clean(m[3]);
      const dates = textDates(when, ctx.today).filter((d) => d >= ctx.today && d <= ctx.horizon);
      if (!dates.length) continue;
      const t = (when.match(/(\d{1,2}:\d{2})\s*$/) || [])[1];
      const ev = await detail(m[1], { city: NY, venue: "Film Forum", area: "Greenwich Village", marquee: "FILM FORUM" }, ctx, { datesFrom: "og" });
      out.push({ title: guest ? `${film}: ${guest}` : film, url: m[1], city: NY, venue: "Film Forum", area: "Greenwich Village", marquee: "FILM FORUM",
        dates: dates.slice(0, 1), time: t ? t + (Number(t.split(":")[0]) >= 10 && Number(t.split(":")[0]) < 12 ? " AM" : " PM") : undefined, desc: guest ? `${guest.replace(/\.$/, "")}.` : (ev?.desc || ""), image: ev?.image || null, tags: "in person" });
    }
    return out;
  } },
  // Symphony Space: film festivals and screenings among its shows.
  { id: "symphony-space", city: NY, run: async (ctx) => {
    const urls = await links("https://www.symphonyspace.org/events", /symphonyspace\.org\/events\/[a-z0-9-]+$/i, 50);
    const pick = urls.filter((u) => /film|fest|shorts|screen|cinema|movie|doc/i.test(u)).slice(0, 15);
    const got = await pool(pick, 5, (u) => detail(u, { city: NY, venue: "Symphony Space", area: "Upper West Side", marquee: "SYMPHONY" }, ctx, { datesFrom: "page" }));
    return got.filter(Boolean).map((c) => ({ ...c!, dates: c!.dates.slice(0, 3) }));
  } },
  // Eventbrite searches: the one-off festivals, showcases, workshops and mixers.
  ...[NY, LA].map((city) => ({ id: "eventbrite-" + city, city, run: async (ctx: Ctx) => {
    const place = city === NY ? "ny--new-york" : "ca--los-angeles";
    const qs = ["film-festival", "film-screening", "short-film", "acting-workshop", "actors", "filmmakers-networking", "casting-director"];
    const seen = new Set<string>();
    for (const q of qs) for (const u of await links(`https://www.eventbrite.com/d/${place}/${q}/`, /eventbrite\.com\/e\/[a-z0-9-]+-\d+$/i, 30)) seen.add(u);
    // The search page has no description yet, so the slug must already look like a film event.
    const pick = [...seen].filter((u) => FILMY.test(u) && !SKIP.test(u.replace(/-/g, " "))).slice(0, 36);
    const got = await pool(pick, 6, (u) => detail(u, { city, venue: "", area: city === NY ? "New York" : "Los Angeles", marquee: "" }, ctx, { datesFrom: "ld" }));
    return got.filter((c) => c && !c.online).map((c) => ({ ...c!, dates: c!.dates.slice(0, 2), marquee: (c!.venue || "EVENT").split(/\s+/)[0].toUpperCase().slice(0, 10) })) as Cand[];
  } })),
];

function categoryOf(text: string): string {
  const t = text.toLowerCase();
  if (/casting director|agent|manager/.test(t) && /panel|talk|workshop|seminar|q\s*&\s*a/.test(t)) return "casting";
  if (/workshop|master ?class|class\b|intensive|seminar|bootcamp|audition/.test(t)) return "workshop";
  if (/networking|mixer|meet[- ]?up|happy hour/.test(t)) return "networking";
  if (/student|thesis|graduate|nyu|usc|afi|nyfa|school/.test(t)) return "school";
  if (/awards? (?:night|ceremony|show|gala)|\bgala\b/.test(t)) return "awards";
  if (/shorts|short film/.test(t)) return "shorts";
  if (/festival|fest\b/.test(t)) return "festival";
  return "screening";
}
const KICK: Record<string, string> = { casting: "Industry talk", workshop: "Workshop", networking: "Networking night", school: "Student showcase", awards: "Awards night", shorts: "Shorts program", festival: "Film festival", screening: "Screening" };
const WHY: Record<string, string> = {
  casting: "Hear how casting and representation work from people who do it, and ask your own questions.",
  workshop: "A hands-on class to sharpen your audition and on-camera work.",
  networking: "Meet working filmmakers and actors in person, the way most indie jobs actually start.",
  school: "Student filmmakers cast actors all year; this is where you meet the next ones.",
  awards: "A night where the industry gathers, worth following even if you don't attend.",
  shorts: "Short films are where new directors cast new actors; see who's making them.",
  festival: "Festivals are where indie filmmakers show their work and look for their next cast.",
  screening: "See the film and hear from the people who made it.",
};
// One plain sentence from the organiser's own description; a Q&A line wins when there is one.
function whyFrom(desc: string, cat: string): string {
  const s = (desc || "").replace(/^Eventbrite\s*-\s*/i, "").replace(/[\u2700-\u27BF\u{1F300}-\u{1FAFF}*#]+/gu, " ").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 25 && x.length < 230 && x.split(/\s+/).length >= 5 && x !== x.toUpperCase() && !/https?:|ticket|\$\d|buy now|click|subscribe|presents film festival/i.test(x));
  const live = s.find((x) => /\bq\s*&\s*a\b|in person|conversation|discussion|panel|filmmaker|director/i.test(x));
  const pick = (live || s[0] || "").replace(/!+/g, ".");
  return pick ? pick.slice(0, 230) : WHY[cat];
}

async function scanRun(sb: ReturnType<typeof createClient>, opts: { only?: string; dry?: boolean } = {}) {
  const today = nyToday();
  const horizon = addDays(today, 60);
  const report: Record<string, unknown> = { today, mode: "no-ai" };
  if (!opts.dry) {
    const { data: retired } = await sb.from("film_events").update({ status: "retired", updated_at: new Date().toISOString() })
      .lt("ends_on", today.slice(0, 7) + "-01").neq("status", "retired").select("id"); // finished events stay listed until the month ends
    report.retired = retired?.length ?? 0;
  }
  let src: Source[];
  if (opts.only) src = SOURCES.filter((s) => s.id === opts.only);
  else {
    const { data: st } = await sb.from("site_settings").select("events_slice").eq("id", 1).maybeSingle();
    const start = Math.max(0, Number((st as { events_slice?: number } | null)?.events_slice) || 0) % SOURCES.length;
    src = [SOURCES[start]];
    const next = start + 1, done = next >= SOURCES.length;
    if (!opts.dry) await sb.from("site_settings").update(done ? { events_slice: 0, events_last_run: new Date().toISOString() } : { events_slice: next }).eq("id", 1);
    report.slice = `${start + 1}/${SOURCES.length}`;
  }
  const { data: existing } = await sb.from("film_events").select("ekey,title,url,city,palette").gte("ends_on", today);
  const rows = (existing || []) as { ekey: string; title: string; url: string; city: string; palette?: string }[];
  const knownKeys = new Set(rows.map((e) => e.ekey)), knownUrls = new Set(rows.map((e) => normUrl(e.url))), knownNames = new Set(rows.map((e) => normTitle(e.title)));
  const lastPal: Record<string, string | null> = {};
  const ctx: Ctx = { today, horizon, log: [] };
  const added: string[] = [], skipped: string[] = [], errors: string[] = [];
  let found = 0;
  for (const s of src) {
    let cands: Cand[] = [];
    try { cands = await s.run(ctx); } catch (e) { errors.push(`${s.id}: ${String(e).slice(0, 160)}`); continue; }
    found += cands.length;
    if (!cands.length) errors.push(`${s.id}: returned nothing (site changed or blocked?)`);
    for (const c of cands) {
      const title = clean(c.title).slice(0, 120);
      const blob = `${title} ${c.desc || ""} ${c.tags || ""}`;
      if (!title || !c.url || !c.dates.length) { skipped.push(`${s.id}: ${title || c.url} (no upcoming date)`); continue; }
      if (c.online || SKIP.test(title)) { skipped.push(`${s.id}: ${title} (online/off-topic)`); continue; }
      if (!RELEVANT.test(blob)) { skipped.push(`${s.id}: ${title} (no live element)`); continue; }
      // One listing = one event window: drop dates more than two weeks after the first.
      c.dates = c.dates.filter((d) => d <= addDays(c.dates[0], 14));
      if (c.area && c.area === c.area.toUpperCase()) c.area = c.area.toLowerCase().replace(/\b[a-z]/g, (x) => x.toUpperCase());
      const starts = c.dates[0], ends = c.dates[c.dates.length - 1];
      const ekey = `${slug(title)}-${starts.slice(0, 7)}`;
      if (knownKeys.has(ekey) || knownUrls.has(normUrl(c.url)) || knownNames.has(normTitle(title))) continue;
      const cat = categoryOf(blob);
      const page = c.image ? null : await fetchText(c.url);
      const art = c.image ? await artFor(`<meta property="og:image" content="${c.image}">`, c.url) : await artFor(page?.html || "", page?.finalUrl || c.url);
      const row = {
        ekey, title, kicker: `${KICK[cat]} · ${c.area || (c.city === NY ? "New York" : "Los Angeles")}`.slice(0, 80),
        why: whyFrom(c.desc || "", cat), starts_on: starts, ends_on: ends,
        when_lines: [["calendar-event", fmtWhen(c.dates, c.time)], ["map-pin", (c.venue || (c.city === NY ? "New York" : "Los Angeles")).slice(0, 80)]],
        url: c.url, image_url: art.image_url, art_style: art.art_style, art: null,
        marquee_word: (c.marquee || "").toUpperCase().slice(0, 10) || null,
        palette: nextPalette(rows.filter((e) => e.city === c.city).map((e) => e.palette || ""), lastPal[c.city] || null),
        status: "published", source: "agent", city: c.city, category: cat,
      };
      if (opts.dry) { added.push(`${c.city}: ${title} | ${row.starts_on}${ends !== starts ? "→" + ends : ""} | ${row.kicker} | ${row.why.slice(0, 80)} | img:${art.image_url ? "y" : "n"}`); }
      else {
        const { error } = await sb.from("film_events").insert(row);
        if (error) { errors.push(`${title}: ${error.message.slice(0, 100)}`); continue; }
        added.push(`${c.city}: ${title}`);
      }
      knownKeys.add(ekey); knownUrls.add(normUrl(c.url)); knownNames.add(normTitle(title));
      rows.push({ ekey, title, url: c.url, city: c.city, palette: row.palette });
      lastPal[c.city] = row.palette;
    }
  }
  Object.assign(report, { sources: src.map((s) => s.id), found, added, skipped: skipped.slice(0, 40), errors });
  console.log("[events-refresh]", JSON.stringify(report).slice(0, 4000));
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
      const ask = (m: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: btoa(bin) } }] }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(45000),
      });
      let g = await ask(model);
      if (!g.ok && model !== "gemini-flash-latest") g = await ask("gemini-flash-latest"); // newest model can refuse images
      if (!g.ok) { tried.push(e.title + ": vision error " + g.status + " " + (await g.text()).slice(0, 120).replace(/\s+/g, " ")); continue; }
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
  // Gemini down or out of credits: don't record "none" for the month, so tomorrow's run tries again.
  if (tried.some((t) => t.includes("vision error"))) return { picked: null, tried, retry: "vision unavailable, will retry next run" };
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
  // ?mode=scan&source=<id>&dry=1 → test one source without writing anything.
  if (url.searchParams.get("mode") === "scan") return json({ ok: true, ...(await scanRun(sb, { only: url.searchParams.get("source") || undefined, dry: url.searchParams.get("dry") === "1" })) });
  if (url.searchParams.get("wait") === "1") return json({ ok: true, ...(await scanRun(sb)) });
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(scanRun(sb).catch((e) => console.error("[events-refresh] failed", e)));
  return json({ ok: true, started: true }, 202);
});

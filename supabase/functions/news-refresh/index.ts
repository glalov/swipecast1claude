// news-refresh — Supabase Edge Function
// Auto-collects entertainment-industry news from approved trade RSS feeds,
// writes a FULL ORIGINAL CastSlate post for each ("Written by CastSlate Staff"),
// attaches a real movie/cast image via TMDB's official API, and publishes to
// public.news_articles. A small non-linked "Reported by X" credit is kept.
//
// LEGALLY SAFE BY DESIGN:
//   • Pulls only headline + short teaser from public RSS feeds (built for syndication).
//   • Never copies source article text — posts are original CastSlate editorial.
//   • Never scrapes source photography (Getty/AP/wire). Images come from TMDB's
//     official API (sanctioned for app display, with TMDB attribution) or a
//     royalty-free fallback pool.
//   • Backstage is intentionally NOT a source.
//
// Optional secrets (Supabase Dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY — if set, posts are written by Claude (higher quality).
//                       Without it, a safe original full-length fallback is used.
//   TMDB_API_KEY      — if set, attaches real movie/TV/cast imagery via TMDB.
//                       Without it, falls back to royalty-free images.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// Real movie stills / cast photos via TMDB's official API (themoviedb.org/settings/api).
// TMDB is the sanctioned channel for apps to display film/TV/person imagery with
// TMDB attribution — unlike scraping Getty/AP wire photos from trade sites.
const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Approved trade sources (NEVER Backstage). Each item links back to its source.
const FEEDS: { name: string; url: string; defaultCat: Category }[] = [
  { name: "Variety", url: "https://variety.com/feed/", defaultCat: "Film" },
  { name: "The Hollywood Reporter", url: "https://www.hollywoodreporter.com/feed/", defaultCat: "Industry" },
  { name: "Deadline", url: "https://deadline.com/feed/", defaultCat: "Film" },
  { name: "IndieWire", url: "https://www.indiewire.com/feed/", defaultCat: "Film" },
  { name: "Playbill", url: "https://playbill.com/rss/news", defaultCat: "Theater" },
  { name: "ScreenDaily", url: "https://www.screendaily.com/feeds/rss/news", defaultCat: "Film" },
];

type Category = "Casting" | "Film" | "Theater" | "Industry" | "Actors";

// Royalty-free imagery: cinematic shots of real people / sets / stages (Unsplash
// license). Used when TMDB has no match. Not source photography. All verified.
const IMAGES: Record<Category, string[]> = {
  Casting: [
    "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=900&q=80&auto=format&fit=crop",
  ],
  Film: [
    "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=900&q=80&auto=format&fit=crop",
  ],
  Theater: [
    "https://images.unsplash.com/photo-1503095396549-807759245b35?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=900&q=80&auto=format&fit=crop",
  ],
  Industry: [
    "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1542204165-65bf26472b9b?w=900&q=80&auto=format&fit=crop",
  ],
  Actors: [
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1454023492550-5696f8ff10e1?w=900&q=80&auto=format&fit=crop",
  ],
};
// Extra verified royalty-free shots for de-duplication overflow.
const EXTRA_IMAGES: string[] = [
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=900&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?w=900&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?w=900&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=900&q=80&auto=format&fit=crop",
];

// Only keep stories relevant to acting / casting / film / TV / theater / industry.
const RELEVANT = /\b(cast|casting|audition|actor|actress|role|film|movie|cinema|tv|television|series|theater|theatre|stage|broadway|production|studio|director|screen|sag-?aftra|premiere|festival)\b/i;

function pickCategory(text: string, fallback: Category): Category {
  const t = text.toLowerCase();
  if (/\b(cast|casting|audition)\b/.test(t)) return "Casting";
  if (/\b(theater|theatre|stage|broadway|playbill)\b/.test(t)) return "Theater";
  if (/\b(actor|actress|star|performer)\b/.test(t)) return "Actors";
  if (/\b(film|movie|cinema|premiere|festival|screen)\b/.test(t)) return "Film";
  return fallback || "Industry";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function stripHtml(s: string): string {
  return (s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#8217;|&#039;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&#8230;|&hellip;/g, "…")
    .replace(/&nbsp;/g, " ").replace(/&[a-z0-9#]+;/gi, " ").replace(/\s+/g, " ").trim();
}

interface FeedItem { title: string; link: string; description: string; pubDate: string; }

function parseRss(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks) {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? stripHtml(m[1]) : "";
    };
    const linkRaw = b.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    items.push({
      title: get("title"),
      link: linkRaw ? stripHtml(linkRaw[1]) : "",
      description: get("description"),
      pubDate: get("pubDate") || get("dc:date"),
    });
  }
  return items;
}

// Claude fallback writer (used only if Gemini is unavailable). Shares the same
// original-news prompt as Gemini.
async function aiRewrite(title: string, desc: string, source: string, category: Category) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2600,
        messages: [{ role: "user", content: rewritePrompt(title, desc, source, category) }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return parseModelJson(j?.content?.[0]?.text || "");
  } catch (_) {
    return null;
  }
}

// Shared instruction for any model: write an ORIGINAL post (never a reworded
// copy) that reports the real facts from the feed teaser in CastSlate's voice.
function rewritePrompt(title: string, desc: string, source: string, category: Category) {
  return `You are a news writer for a casting and entertainment-industry publication. Using the headline and teaser below as your factual basis, write an ORIGINAL, in-depth news article in your own words. Do NOT copy or closely reword the source's sentences — write entirely fresh prose with your own structure.\n\nRequirements:\n- Be accurate and specific: the real names of people, companies, projects, and events must be correct, and the article must clearly be about that subject.\n- Keep the focus on the SUBJECT of the news — the people, companies, productions, and what is happening. Report it like a real journalist would.\n- Write a substantial article of 6 to 8 well-developed paragraphs: what happened, who is involved, relevant background and context, and why it matters for actors and casting.\n- Do NOT make the article about the publisher. Mention the brand name "CastSlate" at most ONCE, lightly, near the end — and ideally not at all. Never start paragraphs with "CastSlate". No repetition of the brand.\n- Professional, neutral news voice. Do not tell readers to visit another website.\n\nCategory: ${category}\nHeadline: ${title}\nTeaser: ${desc}\n\nReturn ONLY valid JSON: {"headline": "<accurate original headline, max 14 words>", "excerpt": "<1 original sentence summarizing the story, max 30 words, no brand name>", "body": "<6 to 8 substantial original paragraphs separated by \\n\\n>"}`;
}
function parseModelJson(text: string) {
  const m = (text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (!p.headline || !p.body) return null;
    return p as { headline: string; excerpt: string; body: string };
  } catch (_) { return null; }
}

// Gemini rewrite (Google AI Studio). Key comes from Vault via RPC.
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Retries on 429 (free-tier rate limit) with backoff so a burst of stories
// doesn't get dropped to the fallback.
async function geminiRewrite(key: string, title: string, desc: string, source: string, category: Category, attempt = 0): Promise<{ headline: string; excerpt: string; body: string } | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: rewritePrompt(title, desc, source, category) }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 3200,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (r.status === 429 && attempt < 3) {
      await sleep(8000 * (attempt + 1));
      return geminiRewrite(key, title, desc, source, category, attempt + 1);
    }
    if (!r.ok) return null;
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseModelJson(text);
  } catch (_) { return null; }
}

// Safe fallback: an original CastSlate blurb built from the headline only.
// Never copies the source description verbatim.
function fallbackRewrite(title: string, source: string, category: Category) {
  const headline = title.replace(/\s*[\|\-–—]\s*[^|\-–—]*$/, "").trim() || title;
  const cat = category.toLowerCase();
  const excerpt = `A ${cat} development CastSlate is tracking for what it could mean for casting and working actors.`;
  const body =
    `A developing ${cat} story is drawing attention across the industry: “${headline}.” In a business that moves on momentum, developments like this tend to ripple outward into casting decisions, production timelines, and the kinds of roles that open up next.\n\n` +
    `For performers, the practical question is always the same — does this change where the work is, or who is being seen for it? Shifts in ${cat} activity often precede new auditions, recasts, or expanded ensembles, and the people who track them early tend to be the first in the room.\n\n` +
    `The broader takeaway is that timing and preparation matter. A current profile, a ready reel, and a clear sense of one's casting lane turn a passing headline into a real opportunity.\n\n` +
    `Written by CastSlate Staff.`;
  return { headline, excerpt, body };
}

// Find a real, relevant image via TMDB (movie/TV poster/still or person photo).
// Returns a TMDB image URL or null. Falls back to royalty-free pool when null.
async function tmdbImage(headline: string): Promise<string | null> {
  if (!TMDB_API_KEY) return null;
  // Prefer a quoted title in the headline (e.g. 'The Four Seasons'); else use
  // the leading words (often a name or show title).
  const quoted = headline.match(/['"“”‘’]([^'"“”‘’]{2,60})['"“”‘’]/);
  const query = (quoted ? quoted[1] : headline.split(/\s+/).slice(0, 5).join(" "))
    .replace(/[^\w\s'-]/g, " ").trim();
  if (!query) return null;
  try {
    const u = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&include_adult=false&query=${encodeURIComponent(query)}`;
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const results = (j?.results || []) as Array<Record<string, unknown>>;
    for (const res of results) {
      const path = (res.poster_path || res.backdrop_path || res.profile_path) as string | undefined;
      if (path) return `https://image.tmdb.org/t/p/w780${path}`;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Real, freely-licensed photo of the news subject via Wikipedia. Only returns
// images hosted on Wikimedia Commons (CC / public-domain) — never non-free
// local uploads (e.g. posters under /wikipedia/en/). Great for real people.
async function wikiImage(headline: string): Promise<string | null> {
  const q = headline.replace(/[^\w\s'&-]/g, " ").split(/\s+/).slice(0, 8).join(" ").trim();
  if (!q) return null;
  try {
    const u = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=900&redirects=1&origin=*`;
    const r = await fetch(u, { headers: { "User-Agent": "CastSlateNewsBot/1.0 (news section images)" } });
    if (!r.ok) return null;
    const j = await r.json();
    const pages = j?.query?.pages;
    if (!pages) return null;
    const arr = (Object.values(pages) as Array<Record<string, any>>)
      .sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const p of arr) {
      const src = p?.thumbnail?.source as string | undefined;
      if (src && /\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(src)) return src;
    }
    return null;
  } catch (_) { return null; }
}

// Choose a non-repeating image: TMDB (if configured) → Wikipedia/Commons (real
// people, free) → category royalty-free pool → extra pool. Tracks `used` so no
// two articles in a run share an image.
async function pickImage(title: string, category: Category, used: Set<string>): Promise<string> {
  const tryUrl = (u: string | null): string | null => (u && !used.has(u) ? u : null);
  let img = tryUrl(await tmdbImage(title));
  if (img) { used.add(img); return img; }
  img = tryUrl(await wikiImage(title));
  if (img) { used.add(img); return img; }
  for (const c of [...(IMAGES[category] || []), ...EXTRA_IMAGES]) {
    if (!used.has(c)) { used.add(c); return c; }
  }
  return (IMAGES[category] || EXTRA_IMAGES)[0]; // last resort (allow repeat)
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Gemini key lives in Vault (read via service-role-only RPC).
    let geminiKey: string | null = null;
    try {
      const { data } = await sb.rpc("news_get_gemini_key");
      if (data && typeof data === "string") geminiKey = data;
    } catch (_) { /* no key configured */ }

    // Per-source cap so one feed can't dominate; overall cap keeps it compact.
    const PER_SOURCE = 2;
    const candidates: { item: FeedItem; source: string; category: Category }[] = [];

    for (const feed of FEEDS) {
      try {
        const res = await fetch(feed.url, { headers: { "User-Agent": "CastSlateNewsBot/1.0" } });
        if (!res.ok) continue;
        const xml = await res.text();
        const items = parseRss(xml).filter((it) => it.title && it.link);
        let taken = 0;
        for (const it of items) {
          if (taken >= PER_SOURCE) break;
          const hay = `${it.title} ${it.description}`;
          if (!RELEVANT.test(hay)) continue;
          candidates.push({ item: it, source: feed.name, category: pickCategory(hay, feed.defaultCat) });
          taken++;
        }
      } catch (_) { /* skip a failing feed, keep going */ }
    }

    // Dedupe against what we already stored (by source_url); also seed the
    // used-image set with recent images so new posts don't repeat them.
    const links = candidates.map((c) => c.item.link);
    const existing = new Set<string>();
    const used = new Set<string>();
    {
      const { data: recent } = await sb.from("news_articles")
        .select("source_url,image_url").order("written_at", { ascending: false }).limit(40);
      for (const r of (recent || []) as Array<{ source_url: string; image_url: string }>) {
        if (r.source_url) existing.add(r.source_url);
        if (r.image_url) used.add(r.image_url);
      }
    }

    let added = 0;
    for (const c of candidates) {
      if (existing.has(c.item.link)) continue;
      const rewritten =
        (geminiKey ? await geminiRewrite(geminiKey, c.item.title, c.item.description, c.source, c.category) : null)
        || (await aiRewrite(c.item.title, c.item.description, c.source, c.category))
        || fallbackRewrite(c.item.title, c.source, c.category);
      const baseSlug = slugify(rewritten.headline) || slugify(c.item.title) || `story-${Date.now()}`;
      const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      // Real subject image: TMDB → Wikipedia/Commons → royalty-free, de-duplicated.
      const image = await pickImage(c.item.title, c.category, used);
      const written = new Date().toISOString();
      const fetched = c.item.pubDate ? new Date(c.item.pubDate).toISOString() : written;
      const { error } = await sb.from("news_articles").insert({
        slug,
        headline: rewritten.headline,
        excerpt: rewritten.excerpt,
        body: rewritten.body,
        category: c.category,
        image_url: image,
        source_name: c.source,
        source_url: c.item.link,
        author: "CastSlate Staff",
        status: "published",
        published: true,
        fetched_at: isNaN(Date.parse(fetched)) ? written : fetched,
        written_at: written,
      });
      if (!error) added++;
      // Pace requests to stay under Gemini's free-tier per-minute limit.
      if (geminiKey) await sleep(4500);
    }

    // Stamp the run.
    await sb.from("site_settings").update({ news_last_run: new Date().toISOString() }).eq("id", 1);

    return json({ ok: true, added, scanned: candidates.length, model: geminiKey ? "gemini" : (ANTHROPIC_API_KEY ? "claude" : "fallback"), tmdb: !!TMDB_API_KEY });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});

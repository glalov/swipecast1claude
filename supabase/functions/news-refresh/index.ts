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

// Royalty-free imagery pool (Unsplash license — free to use). Source photos are
// never reused; we pick a fitting image per category.
const IMAGES: Record<Category, string[]> = {
  Casting: [
    "https://images.unsplash.com/photo-1507924538820-ede94a04019d?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1521119989659-a83eee488004?w=900&q=80&auto=format&fit=crop",
  ],
  Film: [
    "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=900&q=80&auto=format&fit=crop",
  ],
  Theater: [
    "https://images.unsplash.com/photo-1503095396549-807759245b35?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?w=900&q=80&auto=format&fit=crop",
  ],
  Industry: [
    "https://images.unsplash.com/photo-1518929458119-e5bf444c30f4?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=900&q=80&auto=format&fit=crop",
  ],
  Actors: [
    "https://images.unsplash.com/photo-1542204165-65bf26472b9b?w=900&q=80&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=900&q=80&auto=format&fit=crop",
  ],
};

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

// AI rewrite (Claude). Returns {headline, excerpt, body} or null on failure.
async function aiRewrite(title: string, desc: string, source: string, category: Category) {
  if (!ANTHROPIC_API_KEY) return null;
  const prompt = `You are a staff editor at CastSlate, a casting platform for actors. Using ONLY the headline and brief teaser below as a factual starting point, write an ORIGINAL, full-length CastSlate news post in your own words and your own framing. Do NOT copy or closely paraphrase the source's sentences. Add genuine context and explain what it means for working actors, casting, and the industry. Write a complete, standalone article — do not tell readers to go elsewhere.\n\nReported by: ${source}\nCategory: ${category}\nHeadline: ${title}\nTeaser: ${desc}\n\nReturn ONLY valid JSON: {"headline": "<your own rewritten headline, max 14 words>", "excerpt": "<1 original sentence, max 30 words>", "body": "<4 to 6 substantial original paragraphs separated by \\n\\n>"}`;
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
        max_tokens: 1400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = j?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!parsed.headline || !parsed.body) return null;
    return parsed as { headline: string; excerpt: string; body: string };
  } catch (_) {
    return null;
  }
}

// Safe fallback: an original CastSlate blurb built from the headline only.
// Never copies the source description verbatim; always links back for details.
function fallbackRewrite(title: string, source: string, category: Category) {
  const headline = title.replace(/\s*[\|\-–—]\s*[^|\-–—]*$/, "").trim() || title;
  const cat = category.toLowerCase();
  const excerpt = `A ${cat} development CastSlate is tracking for what it could mean for casting and working actors.`;
  const body =
    `CastSlate is following a developing ${cat} story: “${headline}.” In a business that moves on momentum, items like this are worth an actor's attention because they tend to ripple outward into casting decisions, production timelines, and the kinds of roles that open up next.\n\n` +
    `For performers, the practical question is always the same — does this change where the work is, or who's being seen for it? Shifts in ${cat} activity often precede new auditions, recasts, or expanded ensembles, and the actors who notice early are the ones positioned to submit first.\n\n` +
    `It also reflects a broader pattern we watch closely at CastSlate: the industry rewards preparation and timing. A profile that's current, a reel that's ready, and a clear sense of your casting lane turn news like this into an opportunity rather than a missed window.\n\n` +
    `We'll keep updating this roundup as the picture develops. In the meantime, the takeaway for actors is to stay ready — keep your materials sharp, your availability honest, and your submissions targeted to the roles that genuinely fit your range.\n\n` +
    `This post was written by CastSlate Staff as part of our ongoing coverage of acting, casting, film, television, and theater news.`;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

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

    // Dedupe against what we already stored (by source_url).
    const links = candidates.map((c) => c.item.link);
    let existing = new Set<string>();
    if (links.length) {
      const { data } = await sb.from("news_articles").select("source_url").in("source_url", links);
      existing = new Set((data || []).map((r: { source_url: string }) => r.source_url));
    }

    let added = 0;
    const imgIdx: Record<string, number> = {};
    for (const c of candidates) {
      if (existing.has(c.item.link)) continue;
      const rewritten = (await aiRewrite(c.item.title, c.item.description, c.source, c.category))
        || fallbackRewrite(c.item.title, c.source, c.category);
      const baseSlug = slugify(rewritten.headline) || slugify(c.item.title) || `story-${Date.now()}`;
      const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      // Real movie/cast image via TMDB; royalty-free pool only as a fallback.
      const pool = IMAGES[c.category] || IMAGES.Industry;
      const i = (imgIdx[c.category] = (imgIdx[c.category] ?? 0) + 1) % pool.length;
      const image = (await tmdbImage(c.item.title)) || pool[i];
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
    }

    // Stamp the run.
    await sb.from("site_settings").update({ news_last_run: new Date().toISOString() }).eq("id", 1);

    return json({ ok: true, added, scanned: candidates.length, ai: !!ANTHROPIC_API_KEY });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});

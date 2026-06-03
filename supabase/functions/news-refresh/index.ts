// news-refresh — Supabase Edge Function
// Auto-collects entertainment-industry news from approved trade RSS feeds,
// rewrites each item in CastSlate's own words ("Written by CastSlate Staff"),
// pairs it with a royalty-free image, and publishes to public.news_articles —
// always linking back to the original source.
//
// LEGALLY SAFE BY DESIGN:
//   • Pulls only headline + short metadata from public RSS feeds (built for syndication).
//   • Never copies full articles. Summaries are original CastSlate editorial.
//   • Never reuses source photography — images come from a royalty-free pool.
//   • Every article keeps a credited link back to the original report.
//   • Backstage is intentionally NOT a source.
//
// Optional secret (Supabase Dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY — if set, summaries are rewritten by Claude for higher
//                       quality. Without it, a safe original-blurb fallback is used.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

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
  const prompt = `You are a staff editor at CastSlate, a casting platform for actors. Rewrite this trade-news item as an ORIGINAL short summary in CastSlate's own neutral, professional voice. Do NOT copy phrasing from the source. Focus on what it means for actors and the casting industry.\n\nSource: ${source}\nCategory: ${category}\nHeadline: ${title}\nSummary: ${desc}\n\nReturn ONLY valid JSON: {"headline": "<rewritten headline, max 12 words>", "excerpt": "<1 sentence, max 28 words>", "body": "<2-3 short original paragraphs separated by \\n\\n, ending by pointing readers to the original source for full details>"}`;
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
        max_tokens: 700,
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
  const excerpt = `CastSlate's quick read on a ${category.toLowerCase()} story worth an actor's attention — full details at ${source}.`;
  const body =
    `Industry watchers are tracking a developing ${category.toLowerCase()} story: "${headline}." For working actors and casting teams, items like this can signal shifts in upcoming opportunities, timelines, or expectations.\n\n` +
    `CastSlate is flagging it here as part of our ongoing roundup of acting, casting, and entertainment-industry news. We summarize the signal so you can decide whether it's worth a deeper look.\n\n` +
    `For the complete report and all specifics, read the original coverage at ${source} via the source link below.`;
  return { headline, excerpt, body };
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
      const pool = IMAGES[c.category] || IMAGES.Industry;
      const i = (imgIdx[c.category] = (imgIdx[c.category] ?? 0) + 1) % pool.length;
      const written = new Date().toISOString();
      const fetched = c.item.pubDate ? new Date(c.item.pubDate).toISOString() : written;
      const { error } = await sb.from("news_articles").insert({
        slug,
        headline: rewritten.headline,
        excerpt: rewritten.excerpt,
        body: rewritten.body,
        category: c.category,
        image_url: pool[i],
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

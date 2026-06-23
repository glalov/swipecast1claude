// news-refresh — Supabase Edge Function
// Auto-collects entertainment-industry news from approved trade RSS feeds,
// writes a FULL ORIGINAL CastSlate post for each ("Written by CastSlate Staff"),
// and publishes to public.news_articles. A small non-linked "Reported by X"
// credit is kept and every card links back to the original post.
//
// IMAGES — SOURCE-ONLY:
//   • The ONLY image used is the publisher's OWN thumbnail from its public RSS
//     feed (media:content / media:thumbnail / enclosure / inline <img>) — the
//     image built for syndication, shown WITH a source credit + link-back +
//     no-referrer. No AI images, no stock/royalty-free, no TMDB/Wikipedia.
//   • A story is only published if it carries a real source image AND that image
//     is LANDSCAPE (so the 16:10 card frame crops minimally and faces aren't
//     cut). Square/portrait or image-less items are skipped.
//   • We never scrape full-res photography off the article pages.
//   • Backstage is intentionally NOT a source.
//
// Optional secrets (Supabase Dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY — if set, posts are written by Claude (higher quality).
//                       Without it, a safe original full-length fallback is used.
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

// Minimum width/height ratio for a source image to count as "landscape" so the
// 16:10 card frame (cover) crops only thin slivers and centered faces survive.
const LANDSCAPE_MIN = 1.3;

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

interface FeedItem { title: string; link: string; description: string; pubDate: string; image: string; }

// Pull the post's OWN thumbnail out of the RSS <item> (media:content,
// media:thumbnail, <enclosure type="image/…">, or an inline <img>). This is the
// image the publisher syndicates with the item; it is used (with a source credit
// and a link back to the original post) as the ONLY image for the story.
function extractFeedImage(b: string): string {
  for (const m of b.matchAll(/<media:content\b[^>]*>/gi)) {
    const tag = m[0];
    const url = (tag.match(/\burl=["']([^"']+)["']/i) || [])[1];
    if (url && (/medium=["']image["']/i.test(tag) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) return url;
  }
  const thumb = (b.match(/<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i) || [])[1];
  if (thumb) return thumb;
  for (const m of b.matchAll(/<enclosure\b[^>]*>/gi)) {
    if (/type=["']image\//i.test(m[0])) {
      const u = (m[0].match(/\burl=["']([^"']+)["']/i) || [])[1];
      if (u) return u;
    }
  }
  const enc = b.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
  const hay = (enc ? enc[1] : "") + " " + b;
  return (hay.match(/<img[^>]*\bsrc=["']([^"']+)["']/i) || [])[1] || "";
}

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
      image: extractFeedImage(b),
    });
  }
  return items;
}

// ─── Source-image dimension check ───────────────────────────────────────────
// Read intrinsic dimensions from the first bytes of an image so we keep only
// LANDSCAPE source thumbnails. Supports JPEG / PNG / GIF / WebP. Returns null if
// it can't determine the size (treated as "not landscape" → skipped).
function parseDims(b: Uint8Array): { w: number; h: number } | null {
  // PNG
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
    const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
    if (w > 0 && h > 0) return { w, h };
  }
  // GIF
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    const w = b[6] | (b[7] << 8);
    const h = b[8] | (b[9] << 8);
    if (w > 0 && h > 0) return { w, h };
  }
  // WebP (RIFF....WEBP)
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      if (w > 0 && h > 0) return { w, h };
    } else if (fourcc === "VP8 ") {
      const w = (b[26] | (b[27] << 8)) & 0x3FFF;
      const h = (b[28] | (b[29] << 8)) & 0x3FFF;
      if (w > 0 && h > 0) return { w, h };
    } else if (fourcc === "VP8L" && b[20] === 0x2F) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      const w = (bits & 0x3FFF) + 1;
      const h = ((bits >> 14) & 0x3FFF) + 1;
      if (w > 0 && h > 0) return { w, h };
    }
  }
  // JPEG
  if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xFF) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        const h = (b[i + 5] << 8) | b[i + 6];
        const w = (b[i + 7] << 8) | b[i + 8];
        if (w > 0 && h > 0) return { w, h };
        break;
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return null;
}

async function isLandscapeImage(url: string): Promise<boolean> {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4500);
    const r = await fetch(url, {
      headers: { "Range": "bytes=0-131071", "User-Agent": "CastSlateNewsBot/1.0 (news section images)" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok && r.status !== 206) return false;
    const buf = new Uint8Array(await r.arrayBuffer());
    const dims = parseDims(buf);
    if (!dims) return false;
    return dims.w / dims.h >= LANDSCAPE_MIN;
  } catch (_) {
    return false;
  }
}

// ─── Article writers ─────────────────────────────────────────────────────────
// Claude fallback writer (used only if Gemini is unavailable).
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

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Gemini rewrite (Google AI Studio). Key comes from Vault via RPC. Retries on
// 429 (free-tier rate limit) with backoff so a burst of stories isn't dropped.
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
    if (r.status === 429 && attempt < 2) {
      await sleep(4000 * (attempt + 1));
      return geminiRewrite(key, title, desc, source, category, attempt + 1);
    }
    if (!r.ok) return null;
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseModelJson(text);
  } catch (_) { return null; }
}

// Safe fallback: an original CastSlate blurb built from the headline only.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Caller authentication (verify_jwt is off so the cron token can pass).
  // Allowed: pg_cron (Bearer = news_refresh_token from Vault), server-side calls
  // with the service-role key, and logged-in admin / super_admin users.
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);
    let allowed = token === SERVICE_KEY;
    const sbAuth = createClient(SUPABASE_URL, SERVICE_KEY);
    if (!allowed) {
      const { data: refreshToken } = await sbAuth.rpc("news_get_refresh_token");
      allowed = typeof refreshToken === "string" && refreshToken.length > 0 && token === refreshToken;
    }
    if (!allowed) {
      const { data: userData } = await sbAuth.auth.getUser(token);
      const uid = userData?.user?.id;
      if (uid) {
        const { data: prof } = await sbAuth.from("profiles").select("user_type").eq("id", uid).maybeSingle();
        allowed = !!prof && ["admin", "super_admin"].includes((prof as { user_type: string }).user_type);
      }
    }
    if (!allowed) return json({ ok: false, error: "unauthorized" }, 401);
  } catch (_) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Gemini key lives in Vault (read via service-role-only RPC).
    let geminiKey: string | null = null;
    try {
      const { data } = await sb.rpc("news_get_gemini_key");
      if (data && typeof data === "string") geminiKey = data;
    } catch (_) { /* no key configured */ }

    // Per-source cap so one feed can't dominate; overall cap keeps it compact.
    const PER_SOURCE = 3;
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
          if (!it.image) continue; // source-only images: skip items with no own image
          candidates.push({ item: it, source: feed.name, category: pickCategory(hay, feed.defaultCat) });
          taken++;
        }
      } catch (_) { /* skip a failing feed, keep going */ }
    }

    // Dedupe against what we already stored (by source_url and by image).
    const existing = new Set<string>();
    const usedImg = new Set<string>();
    {
      const { data: recent } = await sb.from("news_articles")
        .select("source_url,image_url,original_image_url").order("written_at", { ascending: false }).limit(60);
      for (const r of (recent || []) as Array<{ source_url: string; image_url: string; original_image_url: string }>) {
        if (r.source_url) existing.add(r.source_url);
        if (r.image_url) usedImg.add(r.image_url);
        if (r.original_image_url) usedImg.add(r.original_image_url);
      }
    }

    let added = 0;
    let skippedNoImg = 0;
    // Cap new articles per invocation so the run finishes within the 150s limit.
    const MAX_NEW = 6;
    for (const c of candidates) {
      if (added >= MAX_NEW) break;
      if (existing.has(c.item.link)) continue;

      // SOURCE-ONLY, LANDSCAPE-ONLY image gate (before the costly rewrite).
      const srcImg = c.item.image;
      if (!srcImg || usedImg.has(srcImg)) continue;
      if (!(await isLandscapeImage(srcImg))) { skippedNoImg++; continue; }

      const rewritten =
        (geminiKey ? await geminiRewrite(geminiKey, c.item.title, c.item.description, c.source, c.category) : null)
        || (await aiRewrite(c.item.title, c.item.description, c.source, c.category))
        || fallbackRewrite(c.item.title, c.source, c.category);
      const baseSlug = slugify(rewritten.headline) || slugify(c.item.title) || `story-${Date.now()}`;
      const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      const written = new Date().toISOString();
      const fetched = c.item.pubDate ? new Date(c.item.pubDate).toISOString() : written;
      usedImg.add(srcImg);
      const { error } = await sb.from("news_articles").insert({
        slug,
        headline: rewritten.headline,
        excerpt: rewritten.excerpt,
        body: rewritten.body,
        category: c.category,
        // Source-only image — the publisher's own RSS thumbnail (landscape).
        image_url: srcImg,
        original_headline: c.item.title || null,
        original_image_url: srcImg,
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
      if (geminiKey && added < MAX_NEW) await sleep(3000);
    }

    // Stamp the run.
    await sb.from("site_settings").update({ news_last_run: new Date().toISOString() }).eq("id", 1);

    return json({ ok: true, added, scanned: candidates.length, skippedNonLandscape: skippedNoImg, model: geminiKey ? "gemini" : (ANTHROPIC_API_KEY ? "claude" : "fallback") });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});

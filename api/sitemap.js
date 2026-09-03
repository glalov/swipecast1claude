// Dynamic sitemap.xml for CastSlate
//
// Why this exists: the sitemap used to be a hand-maintained static file listing
// 18 marketing pages. Every casting page (/casting/:slug) was invisible to
// Google — not because the pages are unindexable (api/casting-og.js already
// gives each one a real <title>, description and canonical), but simply because
// nothing ever told a crawler they existed. This function rebuilds the sitemap
// on request from the database, so a casting is discoverable the hour it opens
// and drops out of the sitemap when it closes, with no deploy in between.
//
// Wired up in vercel.json: /sitemap.xml rewrites here, and the static
// sitemap.xml file was removed (vercel.json rewrites are evaluated AFTER the
// filesystem, so a static file of the same name would silently win).
//
// Fails safe: if Supabase is unreachable or slow, we still emit the static
// pages below rather than an error or an empty urlset — an empty sitemap tells
// Google the site has no pages, which is worse than an out-of-date one.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://mvqhqbjjvgkftninjcby.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_J8nl68IlCex_G9sjNQX1kQ_vsb7AzNc";

const ORIGIN = "https://www.castslate.com";

// Sitemaps cap at 50,000 URLs / 50MB. We're nowhere near it, but bound the
// query so a data problem can never produce a malformed giant document.
const MAX_CASTINGS = 5000;

// The marketing pages, unchanged from the old static sitemap. Private/auth
// routes stay out — they're disallowed in robots.txt.
const STATIC_PAGES = [
  { loc: "/", changefreq: "daily", priority: "1.0" },
  { loc: "/browse-castings", changefreq: "daily", priority: "0.9" },
  { loc: "/pricing", changefreq: "weekly", priority: "0.8" },
  { loc: "/classes", changefreq: "weekly", priority: "0.8" },
  { loc: "/actor-toolkit", changefreq: "weekly", priority: "0.8" },
  { loc: "/manager-mode", changefreq: "monthly", priority: "0.8" },
  { loc: "/tapelink", changefreq: "monthly", priority: "0.8" },
  { loc: "/agency-directory", changefreq: "monthly", priority: "0.9" },
  { loc: "/resources", changefreq: "weekly", priority: "0.7" },
  { loc: "/trust-safety", changefreq: "monthly", priority: "0.7" },
  { loc: "/pay-talent", changefreq: "monthly", priority: "0.7" },
  { loc: "/about", changefreq: "monthly", priority: "0.6" },
  { loc: "/blog", changefreq: "weekly", priority: "0.6" },
  { loc: "/careers", changefreq: "monthly", priority: "0.5" },
  { loc: "/contact", changefreq: "monthly", priority: "0.5" },
  { loc: "/faq", changefreq: "monthly", priority: "0.5" },
  { loc: "/terms", changefreq: "yearly", priority: "0.3" },
  { loc: "/privacy", changefreq: "yearly", priority: "0.3" },
];

function escapeXml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// W3C datetime (YYYY-MM-DD) is all Google reads for <lastmod>; a bad value makes
// it ignore the tag for the whole file, so drop anything unparseable.
function toLastmod(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Only castings a visitor can actually open: published, still open, and past
// their scheduled go-live. Listing a URL that redirects or 404s costs crawl
// budget and is reported as an error in Search Console.
async function fetchCastings() {
  const nowIso = new Date().toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/castings` +
    `?select=slug,updated_at,created_at` +
    `&status=eq.open&published=eq.true` +
    `&slug=not.is.null` +
    `&or=(go_live_at.is.null,go_live_at.lte.${encodeURIComponent(nowIso)})` +
    `&order=created_at.desc` +
    `&limit=${MAX_CASTINGS}`;

  // Don't let a hanging database call hold the crawler (or the function) open.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  const parts = [`    <loc>${escapeXml(ORIGIN + loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

module.exports = async (req, res) => {
  let castings = [];
  try {
    castings = await fetchCastings();
  } catch (_) {
    castings = [];
  }

  const entries = STATIC_PAGES.map(urlEntry);

  const seen = new Set();
  for (const c of castings) {
    const slug = String(c.slug || "").trim();
    // Same character class api/casting-og.js sanitizes to, so we never publish
    // a URL that function would reject.
    if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    entries.push(
      urlEntry({
        loc: `/casting/${slug}`,
        lastmod: toLastmod(c.updated_at || c.created_at),
        changefreq: "daily",
        priority: "0.8",
      })
    );
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join("\n") +
    `\n</urlset>\n`;

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  // One hour at the edge: new castings surface quickly, but a crawler hitting
  // this repeatedly doesn't hammer the database.
  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
  );
  res.setHeader("X-Casting-Count", String(seen.size));
  res.end(xml);
};

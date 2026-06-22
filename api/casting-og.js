// Dynamic Open Graph / social preview for /casting/:slug
//
// Why this exists: CastSlate is a client-rendered app. The catch-all rewrite
// serves index.html for every casting URL, so crawlers (Facebook, iMessage,
// WhatsApp, LinkedIn, X) only ever saw the generic site-wide OG tags + og-image.png.
// This function fetches the casting by slug, then serves the SAME index.html shell
// with the casting's own image/title/description injected into the meta tags.
// Real users still boot the full app normally; only the <head> changes.

const fs = require("fs");
const path = require("path");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://mvqhqbjjvgkftninjcby.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_J8nl68IlCex_G9sjNQX1kQ_vsb7AzNc";

const ORIGIN = "https://www.castslate.com";
const DEFAULT_IMAGE = `${ORIGIN}/og-image.png`;

function escapeAttr(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(str, max) {
  const s = String(str == null ? "" : str).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// Locate index.html across the possible runtime layouts on Vercel.
function readIndexHtml() {
  const candidates = [
    path.join(process.cwd(), "index.html"),
    path.join(__dirname, "..", "index.html"),
    "/var/task/index.html",
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

async function fetchCasting(slug) {
  const url =
    `${SUPABASE_URL}/rest/v1/castings` +
    `?slug=eq.${encodeURIComponent(slug)}` +
    `&status=eq.open&published=eq.true` +
    `&select=title,type,prod,tagline,synopsis,location,casting_image_url,casting_images,slug` +
    `&limit=1`;
  const resp = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function castingImage(c) {
  if (c.casting_image_url) return c.casting_image_url;
  if (Array.isArray(c.casting_images) && c.casting_images.length) {
    const first = c.casting_images[0];
    if (typeof first === "string") return first;
    if (first && first.url) return first.url;
  }
  return DEFAULT_IMAGE;
}

function injectMeta(html, c, slug) {
  const title = `${c.title}${c.type ? ` (${c.type})` : ""} — Now Casting on CastSlate`;
  const descSource =
    c.tagline ||
    c.synopsis ||
    `${c.title}${c.prod ? ` by ${c.prod}` : ""}${c.location ? ` — ${c.location}` : ""}. Apply free on CastSlate.`;
  const desc = truncate(descSource, 200);
  const image = castingImage(c);
  const pageUrl = `${ORIGIN}/casting/${encodeURIComponent(slug)}`;
  const usingCastingImage = image !== DEFAULT_IMAGE;

  const T = escapeAttr(title);
  const D = escapeAttr(desc);
  const IMG = escapeAttr(image);
  const URL = escapeAttr(pageUrl);
  const ALT = escapeAttr(`${c.title} — casting on CastSlate`);

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${T}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${D}"/>`
    )
    .replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      `<link rel="canonical" href="${URL}"/>`
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${T}"/>`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${D}"/>`
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:url" content="${URL}"/>`
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:image" content="${IMG}"/>`
    )
    .replace(
      /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:image:alt" content="${ALT}"/>`
    )
    .replace(
      /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:type" content="article"/>`
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${T}"/>`
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${D}"/>`
    )
    .replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:image" content="${IMG}"/>`
    );

  // Casting photos aren't a fixed 1200x630, so drop the hard-coded dimensions
  // and let the crawler read the real size (wrong dims make FB skip the image).
  if (usingCastingImage) {
    out = out
      .replace(/\s*<meta\s+property="og:image:width"\s+content="[^"]*"\s*\/?>/i, "")
      .replace(/\s*<meta\s+property="og:image:height"\s+content="[^"]*"\s*\/?>/i, "");
  }

  return out;
}

module.exports = async (req, res) => {
  const slug = (req.query && req.query.slug ? String(req.query.slug) : "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");

  const html = readIndexHtml();

  // If we can't read the shell, fall back to a redirect into the SPA so the
  // user still lands on the casting (no preview, but never a broken page).
  if (!html) {
    res.statusCode = 302;
    res.setHeader("Location", `/index.html`);
    res.end();
    return;
  }

  let finalHtml = html;
  try {
    if (slug) {
      const casting = await fetchCasting(slug);
      if (casting) finalHtml = injectMeta(html, casting, slug);
    }
  } catch (_) {
    // On any error, serve the unmodified shell (generic preview) — the app
    // still renders the casting client-side for real users.
    finalHtml = html;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, max-age=300, s-maxage=600, stale-while-revalidate=86400"
  );
  res.end(finalHtml);
};

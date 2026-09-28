// Social preview image (1200x630 PNG) for a casting that has no photo.
//
// Why this exists: api/casting-og.js puts the casting's own photo in og:image,
// but most castings have none, so nearly every shared casting fell back to the
// same site-wide og-image.png — identical cards down a Facebook/X feed, with
// old branding and a "Free forever for actors" line that is no longer true.
// This renders a card for THAT casting instead: title, type, location, union,
// pay and how many roles are open, in current CastSlate colours.
//
//   /api/casting-card?slug=<slug>   card for one open casting
//   /api/casting-card               site-wide default card (source of og-card.png)
//
// Fails safe: an unknown/closed slug or a Supabase error renders the default
// card, never an error — a crawler that gets a 500 caches "no image".

const fs = require("fs");
const path = require("path");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://mvqhqbjjvgkftninjcby.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_J8nl68IlCex_G9sjNQX1kQ_vsb7AzNc";

const NAVY = "#1A1A2E";
const GOLD = "#EAC080";
const CREAM = "#FAF6EE";
const TEAL = "#2A8472";

function readFont(file) {
  const candidates = [
    path.join(__dirname, "_fonts", file),
    path.join(process.cwd(), "api", "_fonts", file),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p);
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

function clip(str, max) {
  const s = String(str == null ? "" : str).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  // Cut on a word boundary so a pay line never ends "…smallest pa…".
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:·—-]+$/, "") + "…";
}

async function fetchCasting(slug) {
  const url =
    `${SUPABASE_URL}/rest/v1/castings` +
    `?slug=eq.${encodeURIComponent(slug)}` +
    `&status=eq.open&published=eq.true` +
    `&select=title,type,location,union_status,pay,roles(count)` +
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

// Minimal element builder — @vercel/og takes React-shaped objects, so no JSX
// or React dependency is needed.
function h(type, style, ...children) {
  const kids = children.flat().filter((k) => k !== null && k !== undefined && k !== false);
  return {
    type,
    props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids },
  };
}

// The favicon's double-headed arrow on a white tile.
function logo() {
  return h(
    "div",
    { alignItems: "center", gap: 18 },
    {
      type: "svg",
      props: {
        width: 58,
        height: 58,
        viewBox: "0 0 32 32",
        children: [
          { type: "rect", props: { width: 32, height: 32, rx: 5, fill: "#FFFFFF" } },
          {
            type: "path",
            props: {
              d: "M3,16 L12.6,6.6 L12.6,11 L19.4,11 L19.4,6.6 L29,16 L19.4,25.4 L19.4,21 L12.6,21 L12.6,25.4 Z",
              fill: "#050510",
            },
          },
        ],
      },
    },
    h("div", { fontSize: 36, fontWeight: 700, color: "#FFFFFF", letterSpacing: -0.5 }, "CastSlate")
  );
}

function chip(text) {
  return h(
    "div",
    {
      fontSize: 25,
      fontWeight: 500,
      color: CREAM,
      border: "2px solid rgba(250,246,238,0.28)",
      borderRadius: 999,
      padding: "8px 22px",
    },
    text
  );
}

function card({ badge, title, chips, line, footLeft }) {
  const titleSize = title.length > 52 ? 58 : title.length > 34 ? 66 : 76;
  return h(
    "div",
    {
      width: 1200,
      height: 630,
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "56px 72px 52px",
      fontFamily: "DM Sans",
      color: "#FFFFFF",
      backgroundColor: NAVY,
      backgroundImage:
        "radial-gradient(ellipse 60% 80% at 8% 0%, rgba(234,192,128,0.16), rgba(26,26,46,0) 70%), linear-gradient(160deg, #2A2C4A 0%, #1F2038 55%, #1A1A2E 100%)",
    },
    h(
      "div",
      { alignItems: "center", justifyContent: "space-between" },
      logo(),
      h(
        "div",
        {
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: 3,
          color: NAVY,
          backgroundColor: GOLD,
          borderRadius: 999,
          padding: "10px 22px",
        },
        badge
      )
    ),
    h(
      "div",
      { flexDirection: "column", gap: 26 },
      h(
        "div",
        { fontSize: titleSize, fontWeight: 800, lineHeight: 1.06, letterSpacing: -2, maxWidth: 1050 },
        title
      ),
      chips.length ? h("div", { gap: 14, flexWrap: "wrap" }, chips.map(chip)) : null,
      line ? h("div", { fontSize: 32, fontWeight: 700, color: GOLD }, line) : null
    ),
    h(
      "div",
      { alignItems: "center", justifyContent: "space-between", fontSize: 26, fontWeight: 500 },
      h(
        "div",
        { alignItems: "center", gap: 14, color: CREAM },
        h("div", { width: 14, height: 14, borderRadius: 999, backgroundColor: TEAL }),
        footLeft
      ),
      h("div", { color: "rgba(250,246,238,0.7)" }, "castslate.com")
    )
  );
}

function castingCard(c) {
  const roles = Array.isArray(c.roles) && c.roles[0] ? Number(c.roles[0].count) || 0 : 0;
  const chips = [c.type, c.location, c.union_status]
    .map((s) => clip(s, 28))
    .filter(Boolean);
  return card({
    badge: "NOW CASTING",
    title: clip(c.title, 70),
    chips,
    line: c.pay ? clip(c.pay, 52).replace(/\.$/, "") : "",
    footLeft:
      roles > 1 ? `${roles} roles open · Apply on CastSlate` : roles === 1 ? "1 role open · Apply on CastSlate" : "Apply on CastSlate",
  });
}

function defaultCard() {
  return card({
    badge: "FOR ACTORS",
    title: "Open casting calls for actors.",
    chips: ["Film", "TV", "Commercials", "Theater"],
    line: "Submit your headshot, reel & résumé to casting directors.",
    footLeft: "Browse open roles on CastSlate",
  });
}

module.exports = async (req, res) => {
  const slug = (req.query && req.query.slug ? String(req.query.slug) : "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");

  let tree = null;
  try {
    if (slug) {
      const c = await fetchCasting(slug);
      if (c) tree = castingCard(c);
    }
  } catch (_) {
    tree = null;
  }
  if (!tree) tree = defaultCard();

  const fonts = [
    ["dmsans-500.woff", 500],
    ["dmsans-700.woff", 700],
    ["dmsans-800.woff", 800],
  ]
    .map(([file, weight]) => ({ data: readFont(file), weight }))
    .filter((f) => f.data)
    .map((f) => ({ name: "DM Sans", data: f.data, weight: f.weight, style: "normal" }));

  const { ImageResponse } = await import("@vercel/og");
  const img = new ImageResponse(tree, { width: 1200, height: 630, fonts });
  const buf = Buffer.from(await img.arrayBuffer());

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  // Crawlers fetch this once per share and cache it themselves; a day at the
  // edge keeps it cheap, and a casting's card only changes if it is edited.
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
  res.end(buf);
};

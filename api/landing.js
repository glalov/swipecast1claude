// Search landing pages: /casting-calls/:key (2026-09-30)
//
// Serves the SAME index.html shell with this page's own title, description,
// canonical and OG tags, plus a visually-hidden crawler block (#cs-seo, next to
// #root — never inside it) listing the matching live castings with links.
// Real visitors boot the app, which opens Browse Castings pre-filtered to the
// same rule and removes #cs-seo on mount.
//
// KEEP IN SYNC with LANDING_PAGES / landingMatches() in swipecast-full.jsx.

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mvqhqbjjvgkftninjcby.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_J8nl68IlCex_G9sjNQX1kQ_vsb7AzNc";
const ORIGIN = "https://www.castslate.com";

const PAGES = {
  "new-york": { label: "Casting Calls in New York", title: "Casting Calls in New York City — Open Auditions | CastSlate",
    desc: "Open casting calls and auditions in New York City for film, TV, theater and commercials. Free to join — create your actor profile and submit today." },
  "film": { label: "Film Casting Calls", title: "Film Casting Calls — Feature, Indie, Short & Student Films | CastSlate",
    desc: "Open casting calls for feature, independent, short, student and experimental films. Browse roles and submit your actor profile free on CastSlate." },
  "student-films": { label: "Student Film Casting Calls", title: "Student Film Casting Calls & Auditions | CastSlate",
    desc: "Student film casting calls from film schools and emerging filmmakers. Build your reel and credits — submit your actor profile free on CastSlate." },
  "short-films": { label: "Short Film Casting Calls", title: "Short Film Casting Calls & Auditions | CastSlate",
    desc: "Open casting calls for short films. Find lead, supporting and featured roles and submit your actor profile free on CastSlate." },
  "commercials": { label: "Commercial Casting Calls", title: "Commercial Casting Calls — Ads, Branded & Print | CastSlate",
    desc: "Commercial, branded content, product demo and print casting calls. Browse paid roles and submit your actor profile free on CastSlate." },
  "tv-and-streaming": { label: "TV & Streaming Casting Calls", title: "TV & Streaming Series Casting Calls | CastSlate",
    desc: "Casting calls for TV, streaming, web and vertical series and pilots. Browse roles and submit your actor profile free on CastSlate." },
  "non-union": { label: "Non-Union Casting Calls", title: "Non-Union Casting Calls & Acting Jobs | CastSlate",
    desc: "Non-union casting calls and acting jobs open to all actors. Browse roles and submit your actor profile free on CastSlate." },
  "sag-aftra": { label: "SAG-AFTRA Casting Calls", title: "SAG-AFTRA Casting Calls & Union Acting Jobs | CastSlate",
    desc: "SAG-AFTRA and union casting calls, including low-budget agreements. Browse roles and submit your actor profile on CastSlate." },
  "theater": { label: "Theater Casting Calls", title: "Theater Casting Calls & Stage Auditions | CastSlate",
    desc: "Theater and stage casting calls, including Off-Broadway productions. Browse roles and submit your actor profile free on CastSlate." },
};

const NY_TERMS = ["new york","new york, ny","new york,ny","nyc","n.y.c","manhattan","brooklyn","queens","the bronx","bronx","staten island","long island","yonkers","westchester","jersey city","hoboken","newark","north jersey","new jersey","nj","nassau","suffolk","harlem","astoria","flushing","the heights","washington heights","upper east","upper west","midtown","downtown","tribeca","soho","noho","lower east","east village","west village","chelsea","flatiron","gramercy","murray hill","hell's kitchen","lincoln center","inwood","riverdale","soundview","fordham","jamaica","corona","elmhurst","ridgewood","bay ridge","bensonhurst","park slope","williamsburg","bushwick","bedford","crown heights","flatbush","east new york","rockaway","fresh meadows","bayside","forest hills","rego park","sunnyside","woodside","jackson heights","maspeth","north bergen","weehawken","union city","bayonne"];
function locHasTerm(loc, term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])", "i").test(loc);
}
function isNewYork(loc) {
  const l = String(loc || "").replace(/\s+/g, " ").trim().toLowerCase();
  return !!l && (locHasTerm(l, "new york") || NY_TERMS.some((t) => locHasTerm(l, t)));
}
function matches(c, key) {
  const type = String(c.type || ""), union = String(c.union_status || "");
  switch (key) {
    case "new-york": return isNewYork(c.location);
    case "film": return /film|feature|proof of concept|pitch trailer/i.test(type);
    case "student-films": return /student/i.test(type);
    case "short-films": return /short/i.test(type);
    case "commercials": return /commercial|branded|product demo|print|hosting|presenter/i.test(type);
    case "tv-and-streaming": return /\btv\b|series|pilot|streaming|television/i.test(type);
    case "non-union": return /non[- ]?union|welcome/i.test(union);
    case "sag-aftra": return /sag/i.test(union);
    case "theater": return /theat(er|re)|broadway|stage|musical/i.test(type);
    default: return false;
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncate(str, max) {
  const s = String(str == null ? "" : str).replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
function readIndexHtml() {
  for (const p of [path.join(process.cwd(), "index.html"), path.join(__dirname, "..", "index.html"), "/var/task/index.html"]) {
    try { return fs.readFileSync(p, "utf8"); } catch (_) {}
  }
  return null;
}

// Live = what Browse treats as live: published, open, already gone live, not
// past expires_at or the deadline day.
async function fetchLive() {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const url = `${SUPABASE_URL}/rest/v1/castings?select=title,type,location,union_status,tagline,slug,pay` +
    `&published=eq.true&status=eq.open` +
    `&or=(go_live_at.is.null,go_live_at.lte.${now})` +
    `&and=(or(expires_at.is.null,expires_at.gt.${now}),or(deadline.is.null,deadline.gte.${today}))` +
    `&order=created_at.desc&limit=500`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

function inject(html, key, list) {
  const P = PAGES[key];
  const url = `${ORIGIN}/casting-calls/${key}`;
  const T = esc(P.title), D = esc(P.desc), U = esc(url);
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${T}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${D}"/>`)
    .replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${U}"/>`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${T}"/>`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${D}"/>`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${U}"/>`)
    .replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${T}"/>`)
    .replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${D}"/>`);
  const items = list.map((c) => {
    const bits = [c.type, c.location, c.union_status].filter(Boolean).join(" · ");
    return `<li><a href="${ORIGIN}/casting/${encodeURIComponent(c.slug)}">${esc(c.title)}</a>${bits ? ` — ${esc(bits)}` : ""}${c.tagline ? `<p>${esc(truncate(c.tagline, 220))}</p>` : ""}</li>`;
  }).join("");
  const others = Object.keys(PAGES).filter((k) => k !== key)
    .map((k) => `<li><a href="${ORIGIN}/casting-calls/${k}">${esc(PAGES[k].label)}</a></li>`).join("");
  const block = `<div id="cs-seo" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);border:0;white-space:normal">
<h1>${esc(P.label)}</h1><p>${D}</p>
${items ? `<h2>Open now (${list.length})</h2><ul>${items}</ul>` : `<p>No open castings in this category right now — new castings are added every week.</p>`}
<p><a href="${ORIGIN}/browse-castings">Browse all casting calls</a></p>
<h2>More casting calls</h2><ul>${others}</ul>
</div>`;
  out = out.replace(/\s*<div id="cs-seo"[^>]*><h1>[\s\S]*?<\/p><\/div>/, "");
  if (out.includes('<div id="root"></div>')) out = out.replace('<div id="root"></div>', '<div id="root"></div>\n  ' + block);
  return out;
}

module.exports = async (req, res) => {
  const key = String((req.query && req.query.key) || "").toLowerCase().replace(/[^a-z-]/g, "");
  const html = readIndexHtml();
  if (!html) { res.statusCode = 302; res.setHeader("Location", "/browse-castings"); res.end(); return; }
  if (!PAGES[key]) {
    // Unknown landing key: send people to Browse rather than a blank page.
    res.statusCode = 301; res.setHeader("Location", "/browse-castings"); res.end(); return;
  }
  let finalHtml = html;
  try {
    const live = (await fetchLive()).filter((c) => matches(c, key));
    finalHtml = inject(html, key, live);
  } catch (_) {
    finalHtml = inject(html, key, []);
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Same policy as casting-og.js: browsers revalidate (the HTML pins the app.js
  // build stamp); the edge caches ten minutes.
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate, s-maxage=600, stale-while-revalidate=60");
  res.end(finalHtml);
};

module.exports.PAGES = PAGES;
module.exports.matches = matches;

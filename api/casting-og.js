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
    `&select=id,title,type,prod,tagline,synopsis,location,pay,union_status,deadline,expires_at,shoot_start,shoot_end,casting_image_url,casting_images,slug,is_admin_created,created_at,approved_at,casting_director_name,posted_by_label` +
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

// Roles for the crawler text block (anon-readable, same data the page shows).
async function fetchRoles(castingId) {
  if (!castingId) return [];
  const url =
    `${SUPABASE_URL}/rest/v1/roles` +
    `?casting_id=eq.${encodeURIComponent(castingId)}` +
    `&select=name,role_type,gender,age_range,pay,description,rate_amount,rate_unit` +
    `&order=created_at.asc&limit=40`;
  try {
    const resp = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function escapeText(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDate(d) {
  if (!d) return "";
  const t = new Date(String(d).length <= 10 ? `${d}T12:00:00Z` : d);
  if (isNaN(t)) return "";
  return t.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// SEO text block (2026-09-30). The app is client-rendered, so the HTML crawlers
// first receive had ~150 characters of text. This puts the casting's real
// content (the same things the page shows — no company/producer names) into a
// visually-hidden block NEXT TO #root. It must never go INSIDE #root: the intro
// curtain and the boot watchdog treat any child of #root as "React mounted".
// The app removes #cs-seo as soon as it mounts, so visitors never see it.
function buildSeoBlock(c, roles, slug) {
  const e = escapeText;
  const facts = [
    c.type && `Project type: ${c.type}`,
    c.location && `Location: ${c.location}`,
    c.union_status && `Union status: ${c.union_status}`,
    c.pay && `Pay: ${String(c.pay).trim()}`,
    c.shoot_start && `Shoots: ${fmtDate(c.shoot_start)}${c.shoot_end ? ` – ${fmtDate(c.shoot_end)}` : ""}`,
    c.deadline && `Apply by: ${fmtDate(c.deadline)}`,
  ].filter(Boolean);
  const roleItems = roles
    .map((r) => {
      const spec = [r.role_type, r.gender, r.age_range, r.pay].filter(Boolean).join(" · ");
      return `<li><strong>${e(r.name || "Role")}</strong>${spec ? ` — ${e(spec)}` : ""}${
        r.description ? `<p>${e(truncate(r.description, 400))}</p>` : ""
      }</li>`;
    })
    .join("");
  return `<div id="cs-seo" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);border:0;white-space:normal">
<article>
<h1>${e(c.title)}${c.type ? ` (${e(c.type)})` : ""} — Casting Call</h1>
${c.tagline ? `<p>${e(c.tagline)}</p>` : ""}
<ul>${facts.map((f) => `<li>${e(f)}</li>`).join("")}</ul>
${c.synopsis ? `<h2>About the project</h2><p>${e(truncate(c.synopsis, 1500))}</p>` : ""}
${roleItems ? `<h2>Roles</h2><ul>${roleItems}</ul>` : ""}
<p><a href="${ORIGIN}/casting/${encodeURIComponent(slug)}">Apply free on CastSlate</a> · <a href="${ORIGIN}/browse-castings">Browse more casting calls</a></p>
</article>
</div>`;
}

// Google job-listing data (schema.org JobPosting), 2026-09-30.
// ONLY for castings posted by real casting directors (is_admin_created false).
// Platform-created castings must NEVER get it: Google's job-posting policy
// requires genuine openings from a real hirer, and a violation can be a manual
// action against the whole site. Owner agreed to this rule on 2026-09-30.
const US_STATES = { AL:1,AK:1,AZ:1,AR:1,CA:1,CO:1,CT:1,DE:1,FL:1,GA:1,HI:1,ID:1,IL:1,IN:1,IA:1,KS:1,KY:1,LA:1,ME:1,MD:1,MA:1,MI:1,MN:1,MS:1,MO:1,MT:1,NE:1,NV:1,NH:1,NJ:1,NM:1,NY:1,NC:1,ND:1,OH:1,OK:1,OR:1,PA:1,RI:1,SC:1,SD:1,TN:1,TX:1,UT:1,VT:1,VA:1,WA:1,WV:1,WI:1,WY:1,DC:1 };
function jobPostingLd(c, roles, slug) {
  if (!c || c.is_admin_created === true) return "";
  const loc = String(c.location || "").trim();
  const remote = /remote|self[- ]?tape|virtual|online/i.test(loc);
  const [city, st] = loc.split(",").map((x) => (x || "").trim());
  const region = st && US_STATES[st.toUpperCase().slice(0, 2)] ? st.toUpperCase().slice(0, 2) : undefined;
  const valid = c.expires_at || (c.deadline ? `${c.deadline}T23:59:59-05:00` : undefined);
  const hirer = String(c.casting_director_name || c.posted_by_label || c.prod || "").trim();
  if (!hirer || !valid) return ""; // Google requires both; skip rather than guess
  const roleHtml = roles
    .map((r) => `<li><strong>${escapeText(r.name || "Role")}</strong>${
      [r.role_type, r.gender, r.age_range, r.pay].filter(Boolean).length ? " — " + escapeText([r.role_type, r.gender, r.age_range, r.pay].filter(Boolean).join(" · ")) : ""
    }${r.description ? `<br/>${escapeText(truncate(r.description, 500))}` : ""}</li>`)
    .join("");
  const description = [
    c.tagline && `<p>${escapeText(c.tagline)}</p>`,
    c.synopsis && `<p>${escapeText(truncate(c.synopsis, 3000))}</p>`,
    roleHtml && `<p>Roles:</p><ul>${roleHtml}</ul>`,
    c.union_status && `<p>Union status: ${escapeText(c.union_status)}</p>`,
    c.pay && `<p>Pay: ${escapeText(String(c.pay).trim())}</p>`,
  ].filter(Boolean).join("");
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: `${c.title}${c.type ? ` — ${c.type}` : ""} (Casting Call)`,
    description: description || escapeText(c.title),
    datePosted: String(c.approved_at || c.created_at || "").slice(0, 10) || undefined,
    validThrough: valid,
    employmentType: ["CONTRACTOR", "TEMPORARY"],
    hiringOrganization: { "@type": "Organization", name: hirer },
    identifier: { "@type": "PropertyValue", name: "CastSlate", value: c.id },
    url: `${ORIGIN}/casting/${encodeURIComponent(slug)}`,
    industry: "Film, Television and Performing Arts",
    occupationalCategory: "27-2011.00 Actors",
  };
  if (remote) {
    ld.jobLocationType = "TELECOMMUTE";
    ld.applicantLocationRequirements = { "@type": "Country", name: "USA" };
  } else if (city) {
    ld.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: city, ...(region ? { addressRegion: region } : {}), addressCountry: "US" } };
  } else {
    return ""; // no location → not eligible; don't guess
  }
  // Pay range from roles with a numeric rate in one unit (day/hour/week/project).
  const UNIT = { hour: "HOUR", day: "DAY", week: "WEEK", month: "MONTH", project: "YEAR" };
  const rated = roles.filter((r) => Number(r.rate_amount) > 0 && UNIT[String(r.rate_unit || "").toLowerCase()] && String(r.rate_unit).toLowerCase() !== "project");
  if (rated.length) {
    const unit = String(rated[0].rate_unit).toLowerCase();
    const same = rated.filter((r) => String(r.rate_unit).toLowerCase() === unit).map((r) => Number(r.rate_amount));
    ld.baseSalary = { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: Math.min(...same), maxValue: Math.max(...same), unitText: UNIT[unit] } };
  }
  const json = JSON.stringify(ld).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// The casting's own photo when it has one; otherwise a card generated for this
// casting by api/casting-card.js (title, type, pay, roles). Most castings have
// no photo, and a feed of identical logo cards was the old fallback.
function castingImage(c, slug) {
  if (c.casting_image_url) return c.casting_image_url;
  if (Array.isArray(c.casting_images) && c.casting_images.length) {
    const first = c.casting_images[0];
    if (typeof first === "string") return first;
    if (first && first.url) return first.url;
  }
  // v= is part of the image URL Facebook caches. Bump it to make Facebook
  // fetch every card again: it keeps a failed image fetch per URL, which is
  // why 2:17 A.M stayed blank after the card's broken first deploy.
  return `${ORIGIN}/api/casting-card?slug=${encodeURIComponent(slug)}&v=2`;
}

function injectMeta(html, c, slug) {
  const title = `${c.title}${c.type ? ` (${c.type})` : ""} — Now Casting on CastSlate`;
  const descSource =
    c.tagline ||
    c.synopsis ||
    `${c.title}${c.prod ? ` by ${c.prod}` : ""}${c.location ? ` — ${c.location}` : ""}. Apply free on CastSlate.`;
  const desc = truncate(descSource, 200);
  const image = castingImage(c, slug);
  const pageUrl = `${ORIGIN}/casting/${encodeURIComponent(slug)}`;
  // Generated cards are exactly 1200x630, so the shell's dimension tags stay.
  const usingCastingImage = !image.startsWith(`${ORIGIN}/api/casting-card`);

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
      /<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:image:secure_url" content="${IMG}"/>`
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
      .replace(/\s*<meta\s+property="og:image:height"\s+content="[^"]*"\s*\/?>/i, "")
      // A casting photo may be JPEG/WebP; the shell's type tag says PNG.
      .replace(/\s*<meta\s+property="og:image:type"\s+content="[^"]*"\s*\/?>/i, "");
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
      if (casting) {
        finalHtml = injectMeta(html, casting, slug);
        const roles = await fetchRoles(casting.id);
        const block = buildSeoBlock(casting, roles, slug);
        const job = jobPostingLd(casting, roles, slug);
        if (job) finalHtml = finalHtml.replace("</head>", `  ${job}\n</head>`);
        // Right after the empty #root, never inside it (see buildSeoBlock).
        // Drop the shell's generic page block first (h1 + p, no nested divs).
        finalHtml = finalHtml.replace(/\s*<div id="cs-seo"[^>]*><h1>[\s\S]*?<\/p><\/div>/, "");
        if (finalHtml.includes('<div id="root"></div>')) {
          finalHtml = finalHtml.replace('<div id="root"></div>', '<div id="root"></div>\n  ' + block);
        }
      }
    }
  } catch (_) {
    // On any error, serve the unmodified shell (generic preview) — the app
    // still renders the casting client-side for real users.
    finalHtml = html;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Browsers must revalidate every time. This page's HTML carries the
  // /app.js?v=<build stamp> reference, and app.js is served immutable for a
  // year — so any HTML a browser keeps pins that visitor to the bundle that
  // was current when they cached it. With max-age=300 plus a day of
  // stale-while-revalidate, a shipped change could stay invisible on casting
  // pages long after it was live everywhere else (that is exactly what
  // happened to the pay-mark change on 2026-09-08). The edge still caches for
  // ten minutes so the OG crawlers this function exists for are cheap, and the
  // stale window is short enough that it cannot outlive a deploy.
  res.setHeader(
    "Cache-Control",
    "public, max-age=0, must-revalidate, s-maxage=600, stale-while-revalidate=60"
  );
  res.end(finalHtml);
};

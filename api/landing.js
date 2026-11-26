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
  "new-york": { label: "Casting Calls in New York", title: "Casting Calls NYC — Open Auditions in New York City | CastSlate",
    desc: "Open casting calls and auditions in New York City for film, TV, theater and commercials, plus a guide to how NYC casting works. Free to join." },
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

// New York has exactly ONE landing page. The SEO agent once made six NYC look-alikes
// (open-casting-calls-nyc, non-union-nyc, film-casting-nyc, …) that split Google's signal
// and pushed /casting-calls/new-york from page 1 to page 4 (Sep 26 → Oct 10, 2026). Any
// such key now 301s here, so their credit flows into the one page.
const NYC_KEY = /(^|-)(nyc|new-?york|ny|manhattan|brooklyn|queens|bronx|staten-island)(-|$)/;

// Visible guide under the NYC listings. KEEP IN SYNC with NYC_GUIDE in swipecast-full.jsx
// (the crawler copy must match what visitors see).
const NYC_GUIDE = [
  ["How NYC casting works", "A casting director posts a breakdown: the project, the roles and who they want. You submit a headshot, résumé and a reel or self-tape; the shortlist gets a callback or an audition. Student, short and indie films across the five boroughs are where many New York actors earn first credits."],
  ["Union or non-union", "SAG-AFTRA covers film, TV and commercials; Actors' Equity covers stage work. Not in a union yet? Submit to roles marked Non-Union or \"Union and non-union welcome\". A non-union actor hired on a SAG-AFTRA project can become eligible to join through a Taft-Hartley waiver."],
  ["Open calls vs. submissions", "An open call means anyone who fits the role can show up at the posted place and time. It's common in theater, where Equity runs Equity Principal Auditions (EPAs) and Equity Chorus Calls (ECCs). Most screen work is by submission: you apply online and wait to be invited in."],
  ["Where New York productions shoot", "Shoots happen on location across all five boroughs and at studios like Silvercup, Kaufman Astoria and Wildflower Studios in Astoria, Queens, and Steiner in Brooklyn. Many New York listings film just across the river in Jersey City and Hoboken, so they're included here too."],
  ["Have this ready before you submit", "A current headshot that looks like you today, a one-page résumé, a short reel or slate if you have one, and a simple self-tape setup: a plain background, light facing you and clear sound. Check the shoot dates and only submit when you're actually available to shoot."],
  ["Stay safe", "Real casting directors don't charge you to audition and won't ask for bank details or your Social Security number before you're booked. Be wary of anyone who makes paid photos or classes a condition of casting. If a listing asks for money up front, walk away and report it."],
];
const NYC_GUIDE_CLOSE = "Every listing above is open now, and casting directors review one profile at a time.";
// KEEP IN SYNC with NYC_STEPS / STUDENT_GUIDE / STUDENT_GUIDE_CLOSE in swipecast-full.jsx.
// NYC Q&A (owner 2026-11-26). KEEP IN SYNC with NYC_QA in swipecast-full.jsx.
const NYC_QA = [["How do I find film auditions in NYC?", "Most New York film roles, from student shorts to indie features, are cast by submission: you send a headshot and résumé, then a self-tape if they ask. Tap Film above to see the film castings open right now. Student films from NYU, Columbia, The New School, SVA and Brooklyn College cast all year and are the quickest way to build credits.", "/casting-calls/student-films", "Student film casting calls"],
  ["Where are commercial auditions in NYC posted?", "Commercial casting moves fast: roles often post and close within days, and the first round is usually a self-tape. Tap Commercial above for open commercial roles and apply soon after one appears. Many commercials are SAG-AFTRA, but non-union spots are posted too."],
  ["How do Broadway and theater auditions work in NYC?", "Most Broadway and Off-Broadway casting runs through casting offices and agents, but Actors' Equity also holds open calls: Equity Principal Auditions (EPAs) and Equity Chorus Calls (ECCs), where non-Equity actors are often seen if time allows. Smaller theater, Off-Off-Broadway shows and readings post breakdowns too. Tap Theater above for open theater roles."],
  ["How do extras get cast in New York?", "Background (extras) work is booked for specific shoot dates, so casting looks for people who are free on the day. Have recent photos ready, know your sizes, and check each listing's date, location and pay before you apply."],
  ["Are there paid acting jobs in NYC?", "Yes. Union work follows SAG-AFTRA or Actors' Equity rates, indie and non-union jobs set their own day rate or flat fee, and many student films are unpaid or pay a small fee. Listings show the pay when the production includes it, so check it before you apply."],
  ["Can I audition in NYC with no experience?", "Yes. Plenty of New York listings welcome newcomers, especially student films, short films and indie projects. Start there to earn credits and reel footage, keep your headshot current, and apply only to roles you genuinely fit."],
  ["Can kids and teens audition in NYC?", "Yes, with a parent or legal guardian managing the account. Roles for young performers say so in the breakdown, and child performers in New York need a Child Performer Permit from the New York State Department of Labor before they work. A parent or guardian should be at every audition and on set."],
  ["Are there free casting calls in NYC?", "Creating a CastSlate profile is free, and real casting directors never charge you to audition. Be wary of anyone who asks for money, bank details or your Social Security number before you're booked, or makes paid photos or classes a condition of casting."],
  ["What auditions are happening in NYC this week?", "Tap Closing this week above to see New York roles whose submission deadline falls in the next seven days. New castings post every day, so check back often and apply early: breakdowns fill quickly."],
  ["How do Netflix and streaming shows cast in New York?", "Streaming series cast through established casting offices, which mostly work with agents and managers rather than open calls. The realistic path is building credits, getting representation and knowing which offices cast in New York.", "/casting-directory", "Casting office directory"],
  ["How does casting work in New York?", "A casting director posts a breakdown: the project, the roles and who they want. You submit a headshot, résumé and a reel or self-tape, and the shortlist gets a callback or audition. SAG-AFTRA covers film, TV and commercials; Actors' Equity covers stage work."],
  ["How do I get auditions in New York?", "Get your basics ready, start with student and indie films, submit early and only when you fit, and treat the self-tape as the audition. Go to theater open calls in Midtown, and once you have a few credits and a reel, look for an agent or manager.", "/agency-directory", "Talent agency directory"],
  ["What should I have ready before I submit?", "A current headshot that looks like you today, a one-page résumé, a short reel or slate if you have one, and a simple self-tape setup: a plain background, light facing you and clear sound."],
  ["Where do New York productions shoot?", "On location across all five boroughs and at studios like Silvercup, Kaufman Astoria and Wildflower Studios in Astoria, Queens, and Steiner in Brooklyn. Many New York listings also film just across the river in New Jersey."]];
const NYC_STEPS = [
  ["Get your basics ready", "A headshot that looks like you today, a one-page résumé and a simple self-tape setup. That's all most New York listings ask for at the start."],
  ["Start with student and indie films", "NYU, Columbia, The New School, SVA and Brooklyn College cast all year. They're the fastest way to get credits and real footage for your reel.", "/casting-calls/student-films", "Student film casting calls"],
  ["Submit early, and only when you fit", "Breakdowns fill quickly, so apply soon after a role posts. Read the role, check the shoot dates, and write a short note on why you're right for it."],
  ["Treat the self-tape as the audition", "Most first rounds in New York are self-tapes now. Learn the lines, frame from the chest up, keep the background plain and the sound clear."],
  ["Go to open calls", "Theater runs open calls in Midtown, including Equity Principal Auditions. Non-Equity actors can often be seen as time allows, so arrive early."],
  ["Then find an agent or manager", "A few credits and a reel make it much easier to get an agent or manager to look. They submit you to work you can't reach on your own.", "/agency-directory", "Talent agency directory"],
];
const STUDENT_GUIDE = [
  ["How student film casting works", "Film students cast their thesis and class projects much like a professional production: they post a breakdown, review submissions, then hold auditions or ask for self-tapes. Shoots usually run a few days, often on weekends, and many happen in New York and Los Angeles."],
  ["Why actors take student films", "Student films are where many actors earn their first credits and their first reel footage. You work on set with a real crew, practise hitting marks and repeating takes, and meet the directors and cinematographers who'll be making indie features in a few years."],
  ["Pay, meals and credit", "Many student films are unpaid or pay a small flat fee, so read each listing carefully before you apply. Expect meals on set, a credit, and a copy of your footage. Ask when you'll get that footage before you agree to the shoot, and get it in writing."],
  ["Union actors on student films", "SAG-AFTRA members can work on student films made under the union's Student Film Agreement, which the school's filmmaker signs before the shoot. Non-union actors can submit to any student film. Every listing on CastSlate shows its union status, so you know before applying."],
  ["Where student films cast", "In New York, look for projects from NYU, Columbia, The New School, SVA and Brooklyn College. In Los Angeles, USC, UCLA, AFI, CalArts and Chapman students cast throughout the school year. Thesis films are usually the most ambitious ones, with the biggest crews."],
  ["How to stand out", "Submit with a current headshot, a short note on why you fit the role, and a clear self-tape if they ask for one. On the day, be on time, know your lines well and be easy to work with: student directors remember actors who made their shoot go well."],
];
const STUDENT_GUIDE_CLOSE = "Every student film above is open now, and the filmmakers review one profile at a time.";

const NY_TERMS = ["new york","new york, ny","new york,ny","nyc","n.y.c","manhattan","brooklyn","queens","the bronx","bronx","staten island","long island","yonkers","westchester","jersey city","hoboken","newark","north jersey","new jersey","nj","nassau","suffolk","harlem","astoria","flushing","the heights","washington heights","upper east","upper west","midtown","downtown","tribeca","soho","noho","lower east","east village","west village","chelsea","flatiron","gramercy","murray hill","hell's kitchen","lincoln center","inwood","riverdale","soundview","fordham","jamaica","corona","elmhurst","ridgewood","bay ridge","bensonhurst","park slope","williamsburg","bushwick","bedford","crown heights","flatbush","east new york","rockaway","fresh meadows","bayside","forest hills","rego park","sunnyside","woodside","jackson heights","maspeth","north bergen","weehawken","union city","bayonne"];
function locHasTerm(loc, term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])", "i").test(loc);
}
function isNewYork(loc) {
  const l = String(loc || "").replace(/\s+/g, " ").trim().toLowerCase();
  return !!l && (locHasTerm(l, "new york") || NY_TERMS.some((t) => locHasTerm(l, t)));
}
const LA_TERMS = ["los angeles","los angeles, ca","los angeles,ca","la","l.a.","hollywood","west hollywood","weho","burbank","glendale","pasadena","santa monica","culver city","studio city","north hollywood","noho","long beach","compton","inglewood","torrance","hawthorne","el segundo","manhattan beach","hermosa beach","redondo beach","venice","marina del rey","playa vista","playa del rey","westwood","brentwood","bel air","beverly hills","west la","koreatown","echo park","silver lake","los feliz","atwater village","eagle rock","highland park","monterey park","alhambra","arcadia","san gabriel","the valley","sherman oaks","encino","van nuys","reseda","chatsworth","thousand oaks","calabasas","malibu","pomona","ontario","rancho cucamonga","san bernardino"];
function canonCity(loc) {
  const l = String(loc || "").replace(/\s+/g, " ").trim();
  if (!l) return "";
  if (isNewYork(l)) return "New York";
  const low = l.toLowerCase();
  if (locHasTerm(low, "los angeles") || LA_TERMS.some((t) => locHasTerm(low, t))) return "Los Angeles";
  return l.split(",")[0].trim().replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}
function safeRe(src) {
  if (!src) return null;
  try { return new RegExp(String(src).slice(0, 200), "i"); } catch (_) { return null; }
}
// Rule-based match for agent-created pages (seo_landing_pages): every rule set must match.
function matchRules(c, r) {
  if (r.city && canonCity(c.location) !== r.city) return false;
  const t = safeRe(r.type_re), u = safeRe(r.union_re), x = safeRe(r.text_re);
  if (r.type_re && !(t && t.test(String(c.type || "")))) return false;
  if (r.union_re && !(u && u.test(String(c.union_status || "")))) return false;
  if (r.text_re && !(x && x.test(`${c.title || ""} ${c.tagline || ""}`))) return false;
  return true;
}
async function fetchDbPages(key) {
  const url = `${SUPABASE_URL}/rest/v1/seo_landing_pages?select=key,label,title,description,city,type_re,union_re,text_re` +
    `&active=eq.true${key ? `&key=eq.${encodeURIComponent(key)}` : ""}&limit=500`;
  try {
    const r = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
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

function inject(html, key, list, dyn) {
  const P = PAGES[key] || { label: dyn.label, title: dyn.title, desc: dyn.description };
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
${key === "new-york" ? `<h2>How to find casting calls in New York City</h2>${NYC_QA.map(([h, p, href, text]) => `<h3>${esc(h)}</h3><p>${esc(p)}${href ? ` <a href="${ORIGIN}${href}">${esc(text)}</a>` : ""}</p>`).join("")}<p>${esc(NYC_GUIDE_CLOSE)} <a href="${ORIGIN}/register-talent">Create a free actor profile</a></p>` : ""}
${key === "student-films" ? `<h2>A guide to student film casting calls</h2>${STUDENT_GUIDE.map(([h, p]) => `<h3>${esc(h)}</h3><p>${esc(p)}</p>`).join("")}<p>${esc(STUDENT_GUIDE_CLOSE)} <a href="${ORIGIN}/register-talent">Create a free actor profile</a></p>` : ""}
<p><a href="${ORIGIN}/browse-castings">Browse all casting calls</a></p>
<h2>More casting calls</h2><ul>${others}</ul>
</div>`;
  out = out.replace(/\s*<div id="cs-seo"[^>]*><h1>[\s\S]*?<\/p><\/div>/, "");
  // Agent-created pages: hand the rules to the app so Browse filters the same way.
  if (dyn) {
    const cfg = { key, label: dyn.label, city: dyn.city || null, type_re: dyn.type_re || null, union_re: dyn.union_re || null, text_re: dyn.text_re || null };
    out = out.replace("</head>", `<script>window.__CS_LANDING=${JSON.stringify(cfg).replace(/</g, "\\u003c")};</script>\n</head>`);
  }
  if (out.includes('<div id="root"></div>')) out = out.replace('<div id="root"></div>', '<div id="root"></div>\n  ' + block);
  return out;
}

module.exports = async (req, res) => {
  const key = String((req.query && req.query.key) || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const html = readIndexHtml();
  if (!html) { res.statusCode = 302; res.setHeader("Location", "/browse-castings"); res.end(); return; }
  if (!PAGES[key] && NYC_KEY.test(key)) {
    res.statusCode = 301; res.setHeader("Location", "/casting-calls/new-york"); res.end(); return;
  }
  let dyn = null;
  if (!PAGES[key]) {
    dyn = key ? (await fetchDbPages(key))[0] || null : null;
    if (!dyn) {
      // Unknown landing key: send people to Browse rather than a blank page.
      res.statusCode = 301; res.setHeader("Location", "/browse-castings"); res.end(); return;
    }
  }
  let finalHtml = html;
  try {
    const live = (await fetchLive()).filter((c) => (dyn ? matchRules(c, dyn) : matches(c, key)));
    finalHtml = inject(html, key, live, dyn);
  } catch (_) {
    finalHtml = inject(html, key, [], dyn);
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
module.exports.matchRules = matchRules;
module.exports.fetchDbPages = fetchDbPages;
module.exports.fetchLive = fetchLive;

// weekly-checkin-run — generates the actor "career note" for every eligible premium
// talent (message_type='weekly_actor_checkin'); in-app only. The function name, the
// message_type and the logs table all keep "weekly" in them because the cron job, the
// admin screen and every existing row key off those identifiers — but the NOTE IS
// MONTHLY as of 2026-09-23.
//
// Why it changed: as a weekly note it had nothing new to say. Open rate fell from 31%
// on an actor's first note to 12% by their seventh, only 5.2% ever acted on the task,
// and the same task came round again within four weeks (Sep 14 and Sep 21 2026 were
// byte-identical). The note was SCHEDULED rather than triggered, so on a quiet week
// with a finished profile the model had to manufacture significance and just
// re-described the profile back at them.
//
// The three structural fixes:
//   1. MONTHLY, on each actor's own anniversary day — the day of the month they signed
//      up — not a fixed calendar date. Everyone receiving it on the 1st reads as a
//      batch mailout, which is the opposite of what this is for. A 28-day floor is
//      enforced besides, so no actor can ever get two in a month.
//   2. The THEME is chosen HERE, in code, excluding the ones used in their last six
//      notes. Asking the model not to repeat itself does not work: it was handed the
//      previous tasks and sent an identical one anyway. The model writes; it does not
//      decide what to write about.
//   3. The facts are NUMBERS from the actor's real month — submissions, decisions
//      received, auditions booked, saved roles about to close — not adjectives about
//      their profile. Numbers change month to month. "Your profile is complete" does not.
// casting_lane was dropped: it is a fixed attribute of the actor, and regenerating it
// every send produced fourteen reshuffles of the same sentence.
//
// NO FALLBACK IS EVER DELIVERED: if the AI cannot produce a real grounded note for a
// talent, that talent is SKIPPED (not messaged, not logged) and counted as `deferred`
// so a later run / the drain cron retries them. Members only ever receive a real note.
//
// NEVER REMIND A MEMBER THEY ARE PAYING, AND NEVER COMMENT ON THEIR ABSENCE. A note
// that opens with "it's been a while since you logged in" turns a quiet month into a
// cancellation — it makes the member weigh the subscription instead of reading the
// advice. This is enforced in three places: the login signal is not collected at all,
// the system prompt forbids the whole topic, and normalize() hard-rejects any note that
// slips through (rejected => deferred => retried, same as any other bad note).
// NOTE FOR FUTURE WORK: this is also why there is no "it was a quiet month" theme. The
// guard cannot tell "you submitted to nothing" from "you have been absent", and the
// product rule wins. Quiet months get an evergreen craft theme instead.
//
// Each invocation processes at most MAX_PER_RUN talents so it always finishes well under
// the edge wall-clock limit (no mid-run kill => no risk of a message without its log =>
// no duplicates). The daily drain cron re-runs to pick up the rest until all are done.
//
// verify_jwt=false; caller must POST {secret} (pg_cron) or an admin/super_admin Bearer JWT.
// TEST MODE:  POST {secret, only_talent_id} — process just that talent, bypass gates, return `sample`.
// DRY RUN:    POST {secret, dry_run:true, limit?:n} — generate but DO NOT write; return preview.
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Gemini model fallback chain — tried in order, failing over INSTANTLY between models.
// Fast+reliable flash-lite first (2.x is grandfathered out for new billing projects and
// the full 3.5-flash intermittently 503s); 3.5-flash kept as a higher-quality fallback.
const GEMINI_MODELS = ["gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-flash-latest"];
const GEMINI_ROUNDS = 2;   // full passes over the chain before giving up
const MAX_PER_RUN = 8;     // talents processed per invocation (drain cron handles overflow)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CTA_LABELS: Record<string, string> = {
  profile: "Complete My Profile",
  media: "Add a Reel or Clip",
  resume: "Upload My Resume",
  skills: "Add My Skills",
  bio: "Write My Bio",
  photos: "Add Photos",
  castings: "Browse Casting Calls",
};
const ALLOWED_CTA = Object.keys(CTA_LABELS);

// Last line of defence for the "never mention the subscription or their absence" rule.
// Deliberately narrow so ordinary acting language survives: "paid gig", "non-paying
// student film" and "plan to submit" are all normal and must NOT trip this.
const BANNED_NOTE_PATTERNS: RegExp[] = [
  // the subscription itself
  /\b(subscription|subscriber|membership|premium\s+(member|plan|account)|billing|billed|invoice|renew(al|s|ed|ing)?)\b/i,
  /\byour\s+(plan|account|premium)\b/i,
  /\$\s?\d+(\.\d+)?\s*(\/|per\s+)?(mo|month|yr|year)\b/i,
  /\b(worth|value)\s+(it|the\s+(money|price|cost))\b/i,
  /\bget(ting)?\s+(the\s+most|your\s+money)\b/i,
  // attendance / dormancy — no legitimate use in a career note
  /\blog(ged|ging)?[\s-]?(in|on)\b/i,
  /\bsign(ed|ing)?[\s-]?in\b/i,
  /\bsince\s+you\s+(last|were)\b/i,
  /\bwelcome\s+back\b/i,
  /\b(been\s+)?(inactive|dormant|absent)\b/i,
  /\bhaven'?t\s+(seen|heard\s+from)\s+you\b/i,
  /\bit'?s\s+been\s+a\s+(while|minute|week|month)\b/i,
  /\b(quiet|slow)\s+(week|month|couple|few|lately)\b/i,
  /\byou'?ve\s+been\s+(away|quiet|off)\b/i,
];

function violatesBannedTopics(c: Record<string, string>): string | null {
  const joined = [c.note, c.doing_well, c.needs_attention, c.task, c.cta_label].join(" \n ");
  for (const re of BANNED_NOTE_PATTERNS) {
    const m = joined.match(re);
    if (m) return m[0];
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
function profileFlags(t: any) {
  const skills = Array.isArray(t.skills) ? t.skills : [];
  const vids = Array.isArray(t.video_links) ? t.video_links : [];
  const photos = Array.isArray(t.additional_photos) ? t.additional_photos : [];
  const bioLen = (t.bio || "").trim().length;
  const hasHeadshot = !!t.headshot_url;
  const hasBio = bioLen > 40;
  const hasSkills = skills.length >= 2;
  const hasResume = !!t.resume_url;
  const hasReel = !!(t.reel_url || vids.length > 0);
  const hasPhotos = photos.length >= 2;
  return {
    hasHeadshot, hasBio, hasSkills, hasResume, hasReel, hasPhotos,
    skillsCount: skills.length, photosCount: photos.length, bioLen,
    union: t.union_status || "", location: t.location || "",
    completed: [hasHeadshot, hasBio, hasSkills, hasResume, hasReel].filter(Boolean).length,
  };
}

// The logs table keys uniqueness on (talent_id, week_start); that column now holds the
// first of the month the note belongs to, so the existing unique index gives us "one
// note per actor per month" for free without a rename or a backfill.
function monthKeyUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// An actor's note lands on the day of the month they signed up. Someone who joined on
// the 31st gets it on the last day of a short month rather than being skipped entirely.
function isAnniversaryToday(createdAt: string | null): boolean {
  if (!createdAt) return false;
  const c = new Date(createdAt);
  if (isNaN(c.getTime())) return false;
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const anchor = Math.min(c.getUTCDate(), daysInMonth);
  return now.getUTCDate() === anchor;
}

function changedSince(prev: Record<string, unknown> | null, cur: ReturnType<typeof profileFlags>): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const keys: [string, string][] = [
    ["hasHeadshot", "added a headshot"], ["hasBio", "added or expanded their bio"],
    ["hasSkills", "added skills"], ["hasResume", "uploaded a resume"],
    ["hasReel", "added a reel/video"], ["hasPhotos", "added more photos"],
  ];
  for (const [k, label] of keys) {
    if (!prev[k] && (cur as Record<string, unknown>)[k]) out.push(label);
  }
  return out;
}

// ─── Editorial themes ────────────────────────────────────────────────────────────
// The run picks ONE per actor, skipping any used in their last six notes, and tells the
// model to write about that and nothing else. This is the repeat-protection, and it
// lives here rather than in the prompt because the prompt version provably failed.
// `when` gates a theme to months where it is actually true, so we never congratulate an
// actor on submissions they did not make.
type Stats = {
  submissions: number; decisions: number; shortlists: number; holds: number;
  auditions: number; savedOpen: number; savedClosingSoon: number; newMatching: number;
  missing: string[]; monthsActive: number;
};
const THEMES: { id: string; brief: string; when: (s: Stats) => boolean }[] = [
  { id: "month_recap", when: (s) => s.submissions > 0,
    brief: "Recap the month using the real numbers only: what they submitted to, and what is still outstanding." },
  { id: "decision_followup", when: (s) => s.decisions > 0,
    brief: "A casting director made a decision on one of their submissions this month. Lead with that specific project and what it suggests about what to target next." },
  { id: "audition_prep", when: (s) => s.auditions > 0,
    brief: "They have an audition coming up. Give one concrete, practical piece of audition or self-tape preparation advice for it." },
  { id: "saved_not_submitted", when: (s) => s.savedOpen > 0,
    brief: "They saved roles and have not submitted to them. Name how many are still open and make the task submitting to one. Do not scold." },
  { id: "closing_soon", when: (s) => s.savedClosingSoon > 0,
    brief: "Saved roles are about to close. This is a short, useful deadline reminder with the specific titles." },
  { id: "new_matching", when: (s) => s.newMatching > 0,
    brief: "New roles went up in their area. Name the specific titles and make the task submitting to them." },
  { id: "profile_gap", when: (s) => s.missing.length > 0,
    brief: "One specific thing is missing from their profile. Explain why that ONE thing changes what a casting director can tell about them, and nothing else." },
  { id: "selftape_craft", when: () => true,
    brief: "A craft note about self-tape quality: framing, sound, the reader, or the first fifteen seconds. Nothing about their profile." },
  { id: "materials_refresh", when: () => true,
    brief: "A note about keeping the resume and credits current. Concrete and specific, not generic advice." },
  { id: "submission_habit", when: () => true,
    brief: "A note about submission habits: how to pick roles worth the effort, or how many to target. Practical and specific." },
  { id: "type_read", when: () => true,
    brief: "A note about how their type reads to a casting director at a glance, and what kind of part that opens. Do not use the words brand, branding, narrative or archetype." },
];
// Deterministic per actor so two people in the same state do not get the same note, and
// so re-running the same month reproduces the same choice.
function hashStr(x: string): number {
  let h = 0; for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) >>> 0;
  return h;
}
function pickTheme(stats: Stats, recent: string[], seed: string) {
  const recentSet = new Set(recent);
  const eligible = THEMES.filter((t) => t.when(stats) && !recentSet.has(t.id));
  // Everything used recently? Fall back to anything valid rather than sending nothing.
  const pool = eligible.length ? eligible : THEMES.filter((t) => t.when(stats));
  const final = pool.length ? pool : THEMES.filter((t) => t.id === "selftape_craft");
  return final[hashStr(seed) % final.length];
}

const SYSTEM_PROMPT =
  "You are a working casting director writing a short, specific MONTHLY check-in note for an actor on the Cast Slate platform. " +
  "Write it like a real person dashing off a quick personal note — plain, direct, human. Never like a form letter, a motivational speaker, or an AI assistant.\n" +
  "ACCURACY (most important):\n" +
  "- Use ONLY the facts in the JSON. Never invent or assume credits, skills, bookings, casting names, numbers, or experience that are not present.\n" +
  "- If a detail is not in the facts, do not mention it. When unsure, say less.\n" +
  "- Reflect their CURRENT state exactly: if the profile is complete, treat it as complete; if something is missing, name that specific thing.\n" +
  "THIS MONTH'S SUBJECT IS ALREADY DECIDED:\n" +
  "- 'this_months_theme.write_about' tells you what this note is about. Write about THAT and nothing else. Do not widen the subject, do not add a second topic, do not tack on profile advice that was not asked for.\n" +
  "- Where the theme calls for numbers, lead with the real numbers in 'this_month'. The numbers are the point; adjectives about their profile are not.\n" +
  "- This note covers a MONTH, not a week. Never write 'this week' or 'weekly'.\n" +
  "NEVER MENTION (hard rule — breaking any of these makes the note unusable):\n" +
  "- Their subscription, membership, premium status, plan, billing, price, renewal, or anything about paying for or getting value from the platform. They already know what they pay; raising it only invites second thoughts. Write as if money was never part of the relationship.\n" +
  "- Whether they have logged in, how long since they last logged in, or that they have been away, quiet, inactive, absent or missed. Never comment on their attendance in any form. No 'it's been a while', no 'welcome back', no 'I haven't seen you', and never describe their month or week as quiet or slow.\n" +
  "- Any guilt, disappointment, urgency, pressure or scolding about what they have not done. Assume they are a busy working actor with a life, not someone who owes you anything.\n" +
  "SOUND HUMAN, NOT AI:\n" +
  "- Use natural speech and contractions. Vary sentence length. Get to the point.\n" +
  "- NEVER use AI-tell phrases or hype words, including: 'in today's competitive industry/landscape', 'as an actor', 'remember,', 'keep in mind', 'it is important to', 'let's dive in', 'journey', 'landscape', 'elevate', 'leverage', 'showcase your talent(s)', 'unlock', 'in the world of', 'when it comes to', 'branding', 'brand', 'narrative', 'archetype', 'personal story'. Say the plain thing instead.\n" +
  "- No emojis. No markdown. American English.\n" +
  "USEFULNESS:\n" +
  "- The note must lead to ONE concrete action they can finish this month. No vague strategy, no pep talks.\n" +
  "- Name specific project titles from the facts wherever the theme involves them.\n" +
  "- If 'profile_changes_this_month' shows real changes, you may acknowledge them in one clause and build on them.\n" +
  "OUTPUT: Return ONLY a JSON object (no prose, no code fences) with exactly these string keys:\n" +
  '{"note","doing_well","needs_attention","task","cta_label","cta_action"}\n' +
  "- note: 2-4 sentence opening on the given theme that mentions something specific and true about them.\n" +
  "- doing_well: one specific thing grounded in the month's facts. If there is genuinely nothing to praise, say something small and honest rather than inventing a strength or complimenting the profile to fill space.\n" +
  "- needs_attention: the single most useful, concrete focus for the month ahead — a specific opportunity or fixable gap, never a scolding.\n" +
  "- task: ONE concrete action they can complete this month, stated plainly, matching the theme.\n" +
  "- cta_action: MUST be exactly one of " + JSON.stringify(ALLOWED_CTA) + " — the one best matching 'task' (use 'castings' for submitting/browsing roles).\n" +
  "- cta_label: a short button label (2-4 words) matching the task.";

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

// deno-lint-ignore no-explicit-any
function normalize(parsed: any): Record<string, string> | null {
  if (!parsed) return null;
  const need = ["note", "doing_well", "needs_attention", "task"];
  for (const k of need) if (!parsed[k] || typeof parsed[k] !== "string" || !parsed[k].trim()) return null;
  let cta = String(parsed.cta_action || "").toLowerCase();
  if (!ALLOWED_CTA.includes(cta)) cta = "castings";
  const label = (typeof parsed.cta_label === "string" && parsed.cta_label.trim()) ? parsed.cta_label.trim() : CTA_LABELS[cta];
  const out = {
    note: parsed.note, doing_well: parsed.doing_well, needs_attention: parsed.needs_attention,
    task: parsed.task, cta_label: label, cta_action: cta,
  };
  // Reject rather than deliver: a note that mentions billing or absence is worse than
  // no note at all. Treated exactly like a failed generation => deferred => retried.
  const bad = violatesBannedTopics(out);
  if (bad) { console.error("[checkin] rejected note, banned topic:", JSON.stringify(bad)); return null; }
  return out;
}

// Try each Gemini model in order, failing over instantly on any error, up to GEMINI_ROUNDS
// full passes. Returns the parsed JSON object or null.
async function callGemini(key: string, factsStr: string): Promise<Record<string, unknown> | null> {
  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: "FACTS:\n" + factsStr }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048, responseMimeType: "application/json" },
  });
  for (let round = 0; round < GEMINI_ROUNDS; round++) {
    for (const model of GEMINI_MODELS) {
      try {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key);
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        if (r.ok) {
          const data = await r.json();
          const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const parsed = extractJson(text);
          if (parsed) return parsed;
        } else {
          console.error("[checkin] gemini error", model, r.status, (await r.text()).slice(0, 200));
        }
      } catch (e) {
        console.error("[checkin] gemini failed", model, String(e));
      }
      // instant failover to the next model
    }
    if (round < GEMINI_ROUNDS - 1) await sleep(1500);
  }
  return null;
}

async function callClaude(factsStr: string): Promise<Record<string, unknown> | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: "FACTS:\n" + factsStr }],
      }),
    });
    if (!r.ok) { console.error("[checkin] anthropic error", r.status, await r.text()); return null; }
    const data = await r.json();
    const text: string = data?.content?.[0]?.text || "";
    return extractJson(text);
  } catch (e) { console.error("[checkin] claude failed", String(e)); return null; }
}

async function generateNote(geminiKey: string | null, input: {
  // deno-lint-ignore no-explicit-any
  t: any; flags: ReturnType<typeof profileFlags>; changes: string[];
  stats: Stats; theme: { id: string; brief: string };
  appTitles: string[]; decisionTitles: string[]; savedTitles: string[]; matchingTitles: string[];
}): Promise<Record<string, string> | null> {
  const { t, flags, changes, stats, theme, appTitles, decisionTitles, savedTitles, matchingTitles } = input;
  const facts = {
    name: t.display_name || "the actor",
    // Settled before the model is called. It writes; it does not choose.
    this_months_theme: { id: theme.id, write_about: theme.brief },
    this_month: {
      submissions: stats.submissions,
      submitted_to_projects: appTitles.slice(0, 4),
      casting_decisions_received: stats.decisions,
      shortlisted_count: stats.shortlists,
      on_hold_count: stats.holds,
      decision_projects: decisionTitles.slice(0, 3),
      upcoming_auditions: stats.auditions,
      saved_roles_still_open_not_submitted: stats.savedOpen,
      saved_role_titles: savedTitles.slice(0, 3),
      saved_roles_closing_within_14_days: stats.savedClosingSoon,
      new_roles_in_their_area: stats.newMatching,
      new_role_titles: matchingTitles.slice(0, 3),
    },
    profile: {
      missing_items: stats.missing,
      completeness: flags.completed + "/5 core items",
      union_status: flags.union || "unknown",
      location: flags.location || "unknown",
    },
    profile_changes_this_month: changes.length ? changes : ["no profile changes"],
    // NOTE: login recency is deliberately NOT provided. If the model can see it, it
    // writes about it, and commenting on a paying member's absence reads as a reproach.
    months_on_platform: stats.monthsActive,
  };
  const factsStr = JSON.stringify(facts, null, 2);
  let parsed = geminiKey ? await callGemini(geminiKey, factsStr) : null;
  let out = normalize(parsed);
  if (!out) { parsed = await callClaude(factsStr); out = normalize(parsed); }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try { body = await req.json(); } catch (_) { /* empty body ok for JWT path */ }

    // Authorize
    let authorized = false;
    const { data: secretRow } = await admin.from("app_secrets").select("value").eq("key", "checkin_cron_secret").maybeSingle();
    if (secretRow?.value && body?.secret && body.secret === secretRow.value) authorized = true;
    if (!authorized) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (token) {
        const { data: u } = await admin.auth.getUser(token);
        if (u?.user?.id) {
          const { data: pr } = await admin.from("profiles").select("user_type").eq("id", u.user.id).maybeSingle();
          if (pr && (pr.user_type === "admin" || pr.user_type === "super_admin")) authorized = true;
        }
      }
    }
    if (!authorized) return json({ error: "unauthorized" }, 401);

    const onlyId = (typeof body?.only_talent_id === "string" && body.only_talent_id) ? body.only_talent_id : null;
    const dryRun = body?.dry_run === true;
    const limit = (typeof body?.limit === "number" && body.limit > 0) ? Math.floor(body.limit) : null;
    // Admin "run now" can ignore the anniversary day. It can NEVER ignore the 28-day
    // floor — that is the guarantee the copy on the site now makes to members.
    const ignoreAnniversary = body?.ignore_anniversary === true || !!onlyId || dryRun;

    // Settings + sender (skip the on/off gate for single-talent test + dry run previews).
    let pausedIds = new Set<string>();
    if (!onlyId && !dryRun) {
      const { data: ss } = await admin.from("site_settings").select("checkin_enabled,checkin_paused,checkin_paused_user_ids").eq("id", 1).maybeSingle();
      if (!ss || ss.checkin_enabled === false || ss.checkin_paused === true) return json({ skipped: true, reason: "disabled_or_paused" });
      pausedIds = new Set(Array.isArray(ss.checkin_paused_user_ids) ? ss.checkin_paused_user_ids : []);
    } else if (!onlyId) {
      const { data: ss } = await admin.from("site_settings").select("checkin_paused_user_ids").eq("id", 1).maybeSingle();
      pausedIds = new Set(Array.isArray(ss?.checkin_paused_user_ids) ? ss.checkin_paused_user_ids : []);
    }

    const { data: senderRow } = await admin.from("profiles").select("id").eq("user_type", "super_admin").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!senderRow) return json({ skipped: true, reason: "no_sender" });
    const senderId = senderRow.id;

    // AI key (Gemini primary, from Vault via the news RPC).
    let geminiKey: string | null = null;
    try { const { data } = await admin.rpc("news_get_gemini_key"); if (typeof data === "string" && data) geminiKey = data; } catch (_) { /* ignore */ }

    const period = monthKeyUTC();
    const monthAgoIso = new Date(Date.now() - 30 * 86400000).toISOString();

    // Eligible talent — Manager Mode is PREMIUM, so notes go ONLY to paying members.
    let talentQuery = admin.from("profiles")
      .select("id,display_name,headshot_url,bio,skills,resume_url,reel_url,video_links,additional_photos,union_status,location,created_at")
      .eq("user_type", "talent");
    if (onlyId) talentQuery = talentQuery.eq("id", onlyId);
    else talentQuery = talentQuery.eq("membership_status", "active").eq("account_status", "active").neq("banned", true).neq("suspended", true);
    const { data: talents } = await talentQuery.limit(5000);

    // The 28-day floor, by date rather than by month key, so a note can never land
    // twice in quick succession across a month boundary.
    const { data: recentLogs } = await admin.from("weekly_checkin_logs")
      .select("talent_id").gte("week_start", new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10));
    const recentSet = new Set((recentLogs || []).map((r) => r.talent_id));

    // MONTHLY, on each actor's own anniversary day. The cron runs daily and most
    // actors are skipped on any given day — that is intended, and it is what spreads
    // the sends across the month instead of firing them all on the 1st.
    let eligible = (talents || []).filter((t) => {
      if (onlyId) return true;
      if (recentSet.has(t.id)) return false;
      if (pausedIds.has(t.id)) return false;
      if (!ignoreAnniversary && !isAnniversaryToday(t.created_at)) return false;
      return true;
    });
    // Bound per-invocation work so we always finish under the wall-clock limit.
    const cap = onlyId ? eligible.length : (limit ?? MAX_PER_RUN);
    const totalEligible = eligible.length;
    eligible = eligible.slice(0, cap);

    let sent = 0, ai = 0, deferred = 0;
    // deno-lint-ignore no-explicit-any
    let lastContent: any = null;
    // deno-lint-ignore no-explicit-any
    const preview: any[] = [];
    for (let i = 0; i < eligible.length; i++) {
      const t = eligible[i];
      const flags = profileFlags(t);

      const { data: lastLog } = await admin.from("weekly_checkin_logs").select("profile_snapshot").eq("talent_id", t.id).order("week_start", { ascending: false }).limit(1).maybeSingle();
      const changes = changedSince(lastLog?.profile_snapshot || null, flags);

      // ── the month's real numbers ────────────────────────────────────────────
      const { data: apps } = await admin.from("applications")
        .select("status,created_at,audition_at,reviewed_at,casting_id,castings(title)").eq("talent_id", t.id)
        .order("created_at", { ascending: false }).limit(60);
      const appsArr = apps || [];
      const thisMonthApps = appsArr.filter((a) => a.created_at >= monthAgoIso);
      // deno-lint-ignore no-explicit-any
      const appTitles = thisMonthApps.map((a: any) => a?.castings?.title).filter(Boolean) as string[];
      const decided = appsArr.filter((a) => a.reviewed_at && a.reviewed_at >= monthAgoIso && a.status !== "pending");
      // deno-lint-ignore no-explicit-any
      const decisionTitles = decided.map((a: any) => a?.castings?.title).filter(Boolean) as string[];
      const shortlists = decided.filter((a) => a.status === "selected").length;
      const holds = decided.filter((a) => a.status === "hold").length;
      const upcomingAuditions = appsArr.filter((a) => a.audition_at && new Date(a.audition_at) > new Date()).length;
      const appliedCastingIds = new Set(appsArr.map((a) => a.casting_id).filter(Boolean));

      // Saved but never submitted — a real, actionable gap, and one that genuinely
      // differs from month to month.
      const { data: saved } = await admin.from("saved_castings")
        .select("casting_id,castings(title,deadline,status)").eq("user_id", t.id).limit(60);
      const in14 = new Date(Date.now() + 14 * 86400000);
      // deno-lint-ignore no-explicit-any
      const savedOpenRows = (saved || []).filter((r: any) =>
        r?.castings && r.castings.status === "open" && !appliedCastingIds.has(r.casting_id) &&
        (!r.castings.deadline || new Date(r.castings.deadline) >= new Date()));
      // deno-lint-ignore no-explicit-any
      const savedTitles = savedOpenRows.map((r: any) => r.castings.title).filter(Boolean) as string[];
      // deno-lint-ignore no-explicit-any
      const savedClosingSoon = savedOpenRows.filter((r: any) => r.castings.deadline && new Date(r.castings.deadline) <= in14).length;

      const { data: newCastings } = await admin.from("castings").select("title,location").eq("status", "open").gte("created_at", monthAgoIso).limit(120);
      const locKey = (t.location || "").toLowerCase().split(",")[0].trim();
      const matching = (newCastings || []).filter((c) => !locKey || (c.location || "").toLowerCase().includes(locKey));
      const matchingTitles = matching.map((c) => c.title).filter(Boolean) as string[];

      const missing: string[] = [];
      if (!flags.hasHeadshot) missing.push("headshot");
      if (!flags.hasReel) missing.push("reel or video clip");
      if (!flags.hasResume) missing.push("resume");
      if (!flags.hasBio) missing.push("bio");
      if (!flags.hasSkills) missing.push("skills");
      const monthsActive = t.created_at
        ? Math.max(1, Math.floor((Date.now() - new Date(t.created_at).getTime()) / (30 * 86400000))) : 1;

      const stats: Stats = {
        submissions: thisMonthApps.length, decisions: decided.length, shortlists, holds,
        auditions: upcomingAuditions, savedOpen: savedOpenRows.length, savedClosingSoon,
        newMatching: matching.length, missing, monthsActive,
      };

      // ── theme, chosen HERE and not by the model ─────────────────────────────
      const { data: pastThemes } = await admin.from("weekly_checkin_logs")
        .select("theme").eq("talent_id", t.id).order("week_start", { ascending: false }).limit(6);
      const recentThemes = (pastThemes || []).map((r) => r.theme).filter(Boolean) as string[];
      const theme = pickTheme(stats, recentThemes, t.id + period);

      const content = await generateNote(geminiKey, {
        t, flags, changes, stats, theme, appTitles, decisionTitles, savedTitles, matchingTitles,
      });

      // NO FALLBACK: if the AI didn't produce a real grounded note, skip this talent so
      // a later run / the drain cron retries them. They never get a generic note.
      if (!content) {
        deferred++;
        if (dryRun || onlyId) preview.push({ name: t.display_name, theme: theme.id, ok: false });
        continue;
      }
      ai++;
      lastContent = content;
      if (dryRun) { preview.push({ name: t.display_name, theme: theme.id, ok: true, note: content }); continue; }

      const { data: msg, error: msgErr } = await admin.from("messages")
        .insert({ from_id: senderId, to_id: t.id, body: JSON.stringify(content), message_type: "weekly_actor_checkin", checkin_week: period })
        .select("id").single();
      if (msgErr) { console.error("[checkin] insert msg failed", t.id, msgErr.message); deferred++; ai--; continue; }
      await admin.from("weekly_checkin_logs").insert({ talent_id: t.id, message_id: msg.id, week_start: period, status: "sent", task_action: content.cta_action || null, theme: theme.id, profile_snapshot: flags });
      sent++;

      // Fire the premium check-in email nudge (non-fatal). The type string stays
      // "weekly_checkin" because send-notification-email and the member's email
      // preferences both key off it; only the wording it renders has changed.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ to_user_id: t.id, type: "weekly_checkin", task: content.task }),
        });
      } catch (e) { console.error("[checkin] email nudge failed", t.id, String(e)); }

      if (geminiKey && i < eligible.length - 1) await sleep(600); // light pacing between real sends
    }

    if (!onlyId && !dryRun) await admin.from("site_settings").update({ checkin_last_run_at: new Date().toISOString() }).eq("id", 1);
    return json({
      ok: true, cadence: "monthly", dry_run: dryRun, sent, ai, deferred,
      processed: eligible.length, total_eligible: totalEligible, more_remaining: Math.max(0, totalEligible - eligible.length),
      period,
      ...(onlyId ? { sample: lastContent } : {}),
      ...((dryRun || onlyId) ? { preview } : {}),
    });
  } catch (err) {
    console.error("[checkin-run] unexpected", String(err));
    return json({ error: String(err) }, 500);
  }
});

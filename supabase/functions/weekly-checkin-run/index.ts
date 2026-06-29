// weekly-checkin-run — generates the weekly actor "career note" for every eligible
// talent (message_type='weekly_actor_checkin'); in-app only, no email/SMS. Each note
// is written by AI (Gemini primary via the Vault key, Claude secondary if its key is
// set), grounded in the real profile + week-over-week changes + recent activity +
// new matching castings, and told not to repeat prior weeks. Falls back to a
// deterministic generator on any AI failure so a note always goes out.
// verify_jwt=false; caller must POST {secret} (pg_cron) or an admin/super_admin Bearer JWT.
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

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

// Deterministic fallback — ports the client generateWeeklyCheckInContent so a note
// always goes out even if the AI is unavailable.
// deno-lint-ignore no-explicit-any
function fallbackContent(t: any) {
  const f = profileFlags(t);
  if (f.completed < 2) {
    return {
      note: "Your Cast Slate profile is still in the early stage. The best move this week is to complete your basic profile so casting directors can understand who you are and what roles may fit you.",
      doing_well: "You've started your profile, which is the first step.",
      needs_attention: "Your profile needs more material before it can make a strong first impression.",
      casting_lane: "General background and open-call roles",
      task: "Complete your basic profile information.",
      cta_label: "Complete My Profile",
      cta_action: "profile",
    };
  }
  let needs_attention = "", task = "", cta_action = "", cta_label = "Complete This Week's Task";
  if (!f.hasReel) { needs_attention = "Your profile doesn't yet include a reel or video clip. A short, well-lit performance clip — even 30 to 60 seconds — gives casting directors a direct sense of your work before they look further."; task = "Add a short video clip or reel link to your profile this week."; cta_action = "media"; }
  else if (!f.hasResume) { needs_attention = "Your profile is missing a resume. A concise, formatted resume helps casting directors quickly confirm your experience and training at a glance."; task = "Upload your acting resume to your profile."; cta_action = "resume"; }
  else if (!f.hasSkills) { needs_attention = "Your skills section could use more detail. Specific skills and training help your profile appear in more relevant searches."; task = "Add your top skills and any special abilities to your profile."; cta_action = "skills"; }
  else if (!f.hasBio) { needs_attention = "Your bio section is brief. A well-written bio gives casting directors context about your background, training, and what you bring to a project."; task = "Write or expand your actor bio. Two to three focused sentences is enough."; cta_action = "bio"; }
  else if (!f.hasPhotos) { needs_attention = "Additional photos would strengthen your profile. More shots — including a full-length or natural lifestyle photo — help casting directors picture you in a wider range of contexts."; task = "Add at least one additional photo to your profile, such as a full-body or natural lifestyle shot."; cta_action = "photos"; }
  else { needs_attention = "Your profile is in solid shape. The next step is staying active — submitting to castings that match your type keeps your name visible to casting directors who are actively reviewing talent."; task = "Review the current casting calls and submit to any roles that match your type and experience."; cta_action = "castings"; cta_label = "Browse Casting Calls"; }
  let doing_well: string;
  if (f.hasReel) doing_well = "Your profile includes a video clip, which is one of the first things casting directors look for when evaluating talent on the platform.";
  else if (f.hasHeadshot && f.hasBio) doing_well = "You have a headshot and a bio in place, which gives casting directors a solid first impression of who you are and what you bring.";
  else if (f.hasHeadshot) doing_well = "Your headshot is in place. A clear, professional photo is the first thing casting directors see, and yours makes a good first impression.";
  else if (f.hasBio) doing_well = "You have a bio in place, which helps casting directors understand your background and approach before they look at your other materials.";
  else doing_well = "You've filled in your core profile details, which puts you ahead of many accounts that leave key sections blank.";
  let note: string;
  if (f.completed >= 4) note = "Based on your current Cast Slate profile, your materials are in good shape. Your next step is putting that profile to work — casting directors review talent who are active on the platform more regularly than those who are not.";
  else if (f.completed === 3) note = "Your Cast Slate profile is moving in the right direction. You have some strong materials in place, and one or two additions this week could make a meaningful difference in how casting directors respond to your profile.";
  else note = "Here is your career note for this week. Based on your current Cast Slate profile, there are a few targeted steps that could strengthen how your profile reads to casting directors.";
  const uni = (f.union || "").toLowerCase();
  let casting_lane: string;
  if (f.hasReel && f.hasResume) casting_lane = (uni.includes("sag") || uni.includes("aftra")) ? "SAG-AFTRA productions — film and television drama" : "Independent film and television drama";
  else if (f.hasReel) casting_lane = "Short film, student projects, and emerging director work";
  else if (f.hasResume && f.hasBio) casting_lane = "Theater, stage productions, and film with open submissions";
  else casting_lane = "Commercial, branded content, and open-call roles";
  return { note, doing_well, needs_attention, casting_lane, task, cta_label, cta_action };
}

// Monday (ISO) of the current UTC week, as YYYY-MM-DD.
function weekStartUTC(): string {
  const d = new Date();
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
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

const SYSTEM_PROMPT =
  "You are a casting-industry career advisor writing a short, warm, specific weekly check-in note " +
  "for an actor on the Cast Slate platform. Write like a knowledgeable human mentor, never like a form letter.\n" +
  "STRICT RULES:\n" +
  "- Ground every statement ONLY in the JSON facts provided. NEVER invent credits, skills, bookings, casting names, or experience that are not in the facts.\n" +
  "- This note must be DIFFERENT from the 'previous_note_tasks_DO_NOT_REPEAT' list — pick a fresh angle and different wording every week.\n" +
  "- If 'changes_since_last_week' shows real changes, acknowledge them specifically and build on them.\n" +
  "- If there are NO changes and the profile is already solid, do NOT nag about the profile. Instead give a genuinely useful, fresh angle this week: a concrete tip drawn from their activity or the new matching castings, or a rotating industry insight (audition prep, self-tape craft, marketing/branding, networking, mindset, seasonal casting trends). Vary the theme from prior weeks.\n" +
  "- Be concise and human. No emojis. No markdown. American English.\n" +
  "OUTPUT: Return ONLY a JSON object (no prose, no code fences) with exactly these string keys:\n" +
  '{"note","doing_well","needs_attention","casting_lane","task","cta_label","cta_action"}\n' +
  "- note: 2-4 sentence personalized opening.\n" +
  "- doing_well: one specific strength, grounded in facts.\n" +
  "- needs_attention: the single most useful focus for this week (an opportunity or tip, not a scolding).\n" +
  "- casting_lane: the kind of roles/productions that fit them right now.\n" +
  "- task: one concrete action for this week.\n" +
  "- cta_action: MUST be exactly one of " + JSON.stringify(ALLOWED_CTA) + " — choose the one that best matches 'task' (use 'castings' when the task is about submitting/browsing roles).\n" +
  "- cta_label: a short button label (2-4 words) matching the task.";

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

// deno-lint-ignore no-explicit-any
function normalize(parsed: any): Record<string, string> | null {
  if (!parsed) return null;
  const need = ["note", "doing_well", "needs_attention", "casting_lane", "task"];
  for (const k of need) if (!parsed[k] || typeof parsed[k] !== "string") return null;
  let cta = String(parsed.cta_action || "").toLowerCase();
  if (!ALLOWED_CTA.includes(cta)) cta = "castings";
  const label = (typeof parsed.cta_label === "string" && parsed.cta_label.trim()) ? parsed.cta_label.trim() : CTA_LABELS[cta];
  return {
    note: parsed.note, doing_well: parsed.doing_well, needs_attention: parsed.needs_attention,
    casting_lane: parsed.casting_lane, task: parsed.task, cta_label: label, cta_action: cta,
  };
}

async function callGemini(key: string, factsStr: string): Promise<Record<string, unknown> | null> {
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: "FACTS:\n" + factsStr }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 900, responseMimeType: "application/json" },
      }),
    });
    if (!r.ok) { console.error("[weekly-checkin] gemini error", r.status, await r.text()); return null; }
    const data = await r.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return extractJson(text);
  } catch (e) { console.error("[weekly-checkin] gemini failed", String(e)); return null; }
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
    if (!r.ok) { console.error("[weekly-checkin] anthropic error", r.status, await r.text()); return null; }
    const data = await r.json();
    const text: string = data?.content?.[0]?.text || "";
    return extractJson(text);
  } catch (e) { console.error("[weekly-checkin] claude failed", String(e)); return null; }
}

async function generateNote(geminiKey: string | null, input: {
  // deno-lint-ignore no-explicit-any
  t: any; flags: ReturnType<typeof profileFlags>; changes: string[];
  appsThisWeek: number; appTitles: string[]; upcomingAuditions: number;
  matchingCount: number; matchingTitles: string[]; weeksSinceLogin: number | null;
  pastNotes: string[];
}): Promise<Record<string, string> | null> {
  const { t, flags, changes, appsThisWeek, appTitles, upcomingAuditions, matchingCount, matchingTitles, weeksSinceLogin, pastNotes } = input;
  const facts = {
    name: t.display_name || "the actor",
    profile: {
      has_headshot: flags.hasHeadshot, has_bio: flags.hasBio, has_skills: flags.hasSkills,
      has_resume: flags.hasResume, has_reel_or_video: flags.hasReel, has_extra_photos: flags.hasPhotos,
      skills_count: flags.skillsCount, union_status: flags.union || "unknown", location: flags.location || "unknown",
      completeness: flags.completed + "/5 core items",
    },
    changes_since_last_week: changes.length ? changes : ["no profile changes since last week"],
    activity: {
      submissions_this_week: appsThisWeek,
      recent_submission_projects: appTitles.slice(0, 4),
      upcoming_auditions: upcomingAuditions,
      weeks_since_last_login: weeksSinceLogin,
    },
    new_matching_castings_this_week: { count: matchingCount, sample_titles: matchingTitles.slice(0, 4) },
    previous_note_tasks_DO_NOT_REPEAT: pastNotes.slice(0, 4),
  };
  const factsStr = JSON.stringify(facts, null, 2);
  let parsed = geminiKey ? await callGemini(geminiKey, factsStr) : null;
  if (!parsed) parsed = await callClaude(factsStr);
  return normalize(parsed);
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

    // Settings + sender
    const { data: ss } = await admin.from("site_settings").select("checkin_enabled,checkin_paused,checkin_paused_user_ids").eq("id", 1).maybeSingle();
    if (!ss || ss.checkin_enabled === false || ss.checkin_paused === true) return json({ skipped: true, reason: "disabled_or_paused" });
    const pausedIds = new Set(Array.isArray(ss.checkin_paused_user_ids) ? ss.checkin_paused_user_ids : []);

    const { data: senderRow } = await admin.from("profiles").select("id").eq("user_type", "super_admin").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!senderRow) return json({ skipped: true, reason: "no_sender" });
    const senderId = senderRow.id;

    // AI key (Gemini primary, from Vault via the news RPC).
    let geminiKey: string | null = null;
    try { const { data } = await admin.rpc("news_get_gemini_key"); if (typeof data === "string" && data) geminiKey = data; } catch (_) { /* ignore */ }

    const week = weekStartUTC();
    const weekStartIso = week + "T00:00:00Z";

    // Eligible talent — Manager Mode is a PREMIUM feature, so weekly check-ins go
    // ONLY to paying/premium members (membership_status='active'), never free accounts.
    const { data: talents } = await admin.from("profiles")
      .select("id,display_name,headshot_url,bio,skills,resume_url,reel_url,video_links,additional_photos,union_status,location")
      .eq("user_type", "talent").eq("membership_status", "active").eq("account_status", "active").neq("banned", true).neq("suspended", true).limit(5000);
    const { data: sentLogs } = await admin.from("weekly_checkin_logs").select("talent_id").eq("week_start", week);
    const sentSet = new Set((sentLogs || []).map((r) => r.talent_id));
    const eligible = (talents || []).filter((t) => !sentSet.has(t.id) && !pausedIds.has(t.id));

    let sent = 0, ai = 0, fb = 0;
    for (let i = 0; i < eligible.length; i++) {
      const t = eligible[i];
      const flags = profileFlags(t);

      const { data: lastLog } = await admin.from("weekly_checkin_logs").select("profile_snapshot").eq("talent_id", t.id).order("week_start", { ascending: false }).limit(1).maybeSingle();
      const changes = changedSince(lastLog?.profile_snapshot || null, flags);

      const { data: apps } = await admin.from("applications").select("status,created_at,audition_at,castings(title)").eq("talent_id", t.id).order("created_at", { ascending: false }).limit(25);
      const appsThisWeek = (apps || []).filter((a) => new Date(a.created_at) >= new Date(weekStartIso)).length;
      // deno-lint-ignore no-explicit-any
      const appTitles = (apps || []).map((a: any) => a?.castings?.title).filter(Boolean) as string[];
      const upcomingAuditions = (apps || []).filter((a) => a.audition_at && new Date(a.audition_at) > new Date()).length;

      const { data: newCastings } = await admin.from("castings").select("title,location").eq("status", "open").gte("created_at", weekStartIso).limit(60);
      const locKey = (t.location || "").toLowerCase().split(",")[0].trim();
      const matching = (newCastings || []).filter((c) => !locKey || (c.location || "").toLowerCase().includes(locKey));
      const matchingTitles = matching.map((c) => c.title).filter(Boolean) as string[];

      let weeksSinceLogin: number | null = null;
      try {
        const { data: au } = await admin.auth.admin.getUserById(t.id);
        const ls = au?.user?.last_sign_in_at;
        if (ls) weeksSinceLogin = Math.floor((Date.now() - new Date(ls).getTime()) / (7 * 86400000));
      } catch (_) { /* ignore */ }

      const { data: pastLogs } = await admin.from("weekly_checkin_logs").select("message_id").eq("talent_id", t.id).order("week_start", { ascending: false }).limit(4);
      const msgIds = (pastLogs || []).map((l) => l.message_id).filter(Boolean);
      let pastNotes: string[] = [];
      if (msgIds.length) {
        const { data: msgs } = await admin.from("messages").select("body").in("id", msgIds);
        pastNotes = (msgs || []).map((m) => { try { const c = JSON.parse(m.body); return c.task || c.note || ""; } catch (_) { return ""; } }).filter(Boolean) as string[];
      }

      let content = await generateNote(geminiKey, {
        t, flags, changes, appsThisWeek, appTitles, upcomingAuditions,
        matchingCount: matching.length, matchingTitles, weeksSinceLogin, pastNotes,
      });
      if (content) ai++; else { content = fallbackContent(t); fb++; }

      const { data: msg, error: msgErr } = await admin.from("messages")
        .insert({ from_id: senderId, to_id: t.id, body: JSON.stringify(content), message_type: "weekly_actor_checkin", checkin_week: week })
        .select("id").single();
      if (msgErr) { console.error("[weekly-checkin] insert msg failed", t.id, msgErr.message); continue; }
      await admin.from("weekly_checkin_logs").insert({ talent_id: t.id, message_id: msg.id, week_start: week, status: "sent", task_action: content.cta_action || null, profile_snapshot: flags });
      sent++;

      // Fire the premium weekly check-in email nudge (non-fatal). Drives the
      // member back into the app to read the note; gated on their email prefs server-side.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ to_user_id: t.id, type: "weekly_checkin", task: content.task }),
        });
      } catch (e) { console.error("[weekly-checkin] email nudge failed", t.id, String(e)); }

      // Pace AI calls to stay under provider per-minute limits.
      if (geminiKey && i < eligible.length - 1) await sleep(2500);
    }

    await admin.from("site_settings").update({ checkin_last_run_at: new Date().toISOString() }).eq("id", 1);
    return json({ ok: true, sent, ai, fallback: fb, eligible: eligible.length, week_start: week });
  } catch (err) {
    console.error("[weekly-checkin-run] unexpected", String(err));
    return json({ error: String(err) }, 500);
  }
});

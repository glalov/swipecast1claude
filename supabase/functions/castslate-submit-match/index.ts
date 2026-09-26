// castslate-submit-match — proposes actors for CastSlate Submit (admin only).
//
// Admin picks a live casting posted by a real, approved CD. For every role this
// returns every actor who passes the hard filters, ranked by Gemini against the
// role description. It WRITES NOTHING: the admin reviews the list in
// Admin → CastSlate Submit and the public.admin_castslate_submit RPC files the
// applications (and re-validates every row).
//
// Hard filters (code, never the model):
//   talent account · opted in (castslate_submit_opt_in) · has a headshot · adult
//   (not is_minor, age >= 18) · not banned/suspended/deactivated/deleted ·
//   not already applied to that role · role gender allowed by open_to_role_genders
//   (same rules as the site's matcher: open-to-all roles match everyone) ·
//   age inside the role's range (exact age, or an overlapping playable age_range).
// The model then judges the description: fit = strong | good | possible | no.
// No cap: everyone not judged "no" is proposed, and "no" is still returned so the
// admin can add them back by hand. If the model is unavailable the hard-filter
// matches are returned unrated rather than failing the whole run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest"];
const CHUNK = 40;          // candidates per model call
const CONCURRENCY = 6;     // parallel model calls

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Gender: mirrors normRoleGender / defaultOpenToRoleGenders / roleGenderAllowed in swipecast-full.jsx
const ROLE_GENDERS = ["Male", "Female", "Non-Binary"];
function normRoleGender(g: string | null | undefined): string {
  const v = (g || "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (!v || v === "any" || v === "all genders" || v === "all" || v === "open" || v === "any gender") return "any";
  if (v === "male" || v === "man" || v === "men") return "male";
  if (v === "female" || v === "woman" || v === "women") return "female";
  if (v === "non binary" || v === "nonbinary" || v === "enby") return "non-binary";
  return "any";
}
function defaultOpenTo(gender: string | null | undefined): string[] {
  const v = (gender || "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (v === "male" || v === "trans man" || v === "man male" || v === "ftm") return ["Male"];
  if (v === "female" || v === "trans woman" || v === "woman female" || v === "mtf") return ["Female"];
  if (v === "non binary") return ["Non-Binary"];
  return ROLE_GENDERS.slice();
}
// deno-lint-ignore no-explicit-any
function effectiveOpenTo(p: any): string[] {
  if (Array.isArray(p.open_to_role_genders)) return p.open_to_role_genders.filter((g: string) => ROLE_GENDERS.includes(g));
  return defaultOpenTo(p.gender);
}
function genderAllowed(roleGender: string | null, openTo: string[]): boolean {
  const rg = normRoleGender(roleGender);
  if (rg === "any") return true;
  return openTo.map(normRoleGender).includes(rg);
}

// ── Age
function parseRange(s: string | null | undefined): [number, number] | null {
  const t = (s || "").trim();
  let m = t.match(/(\d+)\s*[-–—to]+\s*(\d+)/i);
  if (m) return [parseInt(m[1]), parseInt(m[2])];
  m = t.match(/(\d+)\s*\+/);
  if (m) return [parseInt(m[1]), 120];
  m = t.match(/^(\d+)$/);
  if (m) return [parseInt(m[1]), parseInt(m[1])];
  return null;
}
// deno-lint-ignore no-explicit-any
function ageAllowed(roleRange: [number, number] | null, p: any): boolean {
  if (!roleRange) return true;                       // role names no age → no age filter
  const [lo, hi] = roleRange;
  if (typeof p.age === "number" && p.age >= lo && p.age <= hi) return true;
  const pr = parseRange(p.age_range);                // actor's playable range
  if (pr && pr[0] <= hi && pr[1] >= lo) return true;
  return false;
}

const clip = (s: unknown, n: number) => {
  const t = (typeof s === "string" ? s : Array.isArray(s) ? s.filter(Boolean).join(", ") : "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

const SYSTEM = `You are a casting assistant. For ONE role, judge how well each actor fits the role description, using only the facts given.
Consider: the character described (type, personality, look, skills, special requirements like language, singing, dance, driving, accents), the actor's self-described casting types, skills, training, credits and bio, physical details when the role asks for them, ethnicity only when the role specifies one, and location (the shoot is local unless the casting says remote/self-tape; an actor clearly in another region is at most "possible").
Age and gender are already filtered — do not reject for them.
fit values:
 "strong"  = clearly matches the description
 "good"    = plausible, nothing contradicts it
 "possible"= thin profile or partial match, but nothing rules them out
 "no"      = the description requires something the actor clearly lacks or contradicts
Be generous: a sparse profile is "possible", not "no". Reserve "no" for real contradictions.
reason: at most 16 words, concrete, about the actor (e.g. "Lists fluent Spanish and two commercial credits"). Never mention age or gender.
Return JSON only: {"results":[{"i":<number>,"fit":"strong|good|possible|no","reason":"..."}]} with one entry per actor.`;

async function callGemini(key: string, prompt: string): Promise<{ i: number; fit: string; reason: string }[] | null> {
  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
  });
  for (let round = 0; round < 2; round++) {
    for (const model of GEMINI_MODELS) {
      try {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key);
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        if (!r.ok) { console.error("[cs-match] gemini", model, r.status, (await r.text()).slice(0, 200)); continue; }
        const data = await r.json();
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) continue;
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed?.results)) return parsed.results;
      } catch (e) {
        console.error("[cs-match] gemini failed", model, String(e));
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const k = next++; out[k] = await tasks[k](); } };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Admin only.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user?.id) return json({ error: "unauthorized" }, 401);
    const { data: me } = await admin.from("profiles").select("user_type").eq("id", u.user.id).maybeSingle();
    if (!me || !["admin", "super_admin"].includes(me.user_type)) return json({ error: "forbidden" }, 403);

    let body: { casting_id?: string } = {};
    try { body = await req.json(); } catch (_) { /* */ }
    const castingId = body.casting_id;
    if (!castingId) return json({ error: "casting_id required" }, 400);

    const { data: c } = await admin.from("castings")
      .select("id,title,type,prod,synopsis,tagline,location,shoot_location,union_status,pay,deadline,status,published,is_admin_created,has_nudity,submission_requirements,cd_id,roles(id,name,description,age_range,gender,ethnicity,role_type,pay)")
      .eq("id", castingId).maybeSingle();
    if (!c) return json({ error: "casting not found" }, 404);
    const { data: cd } = await admin.from("profiles").select("user_type,can_post_castings,display_name,company_name").eq("id", c.cd_id).maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    const eligible = !c.is_admin_created && c.status === "open" && c.published && !c.has_nudity &&
      (!c.deadline || c.deadline >= today) && cd?.user_type === "cd" && cd?.can_post_castings === true;
    if (!eligible) return json({ error: "This casting is not eligible (must be a live casting by an approved CD, without nudity)." }, 400);

    // Talent pool — paged, PostgREST caps a single read at 1000 rows.
    const cols = "banned,suspended,deleted_at,deactivated_at,deletion_requested_at,id,display_name,age,age_range,gender,open_to_role_genders,ethnicity,location,height,body_type,hair,eyes,union_status,headshot_url,membership_status,casting_types,casting_type_other,talent_types,skills,training,credits,bio,castslate_submit_opt_in,is_minor";
    // deno-lint-ignore no-explicit-any
    const talent: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("profiles").select(cols)
        .eq("user_type", "talent")
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      talent.push(...(data || []).filter((p) => !p.banned && !p.suspended && !p.deleted_at && !p.deactivated_at && !p.deletion_requested_at));
      if (!data || data.length < 1000) break;
    }

    // Existing applications to this casting (any role).
    const applied = new Set<string>();
    {
      const { data } = await admin.from("applications").select("role_id,talent_id").eq("casting_id", castingId);
      (data || []).forEach((a) => applied.add(a.role_id + ":" + a.talent_id));
    }

    const { data: keyData } = await admin.rpc("news_get_gemini_key");
    const geminiKey = typeof keyData === "string" && keyData ? keyData : null;

    const castingCtx = [
      `CASTING: ${c.title}${c.prod ? " — " + c.prod : ""}`,
      `Type: ${c.type || "—"} · Union: ${c.union_status || "—"} · Location: ${c.shoot_location || c.location || "—"}`,
      c.tagline ? `Tagline: ${clip(c.tagline, 200)}` : "",
      c.synopsis ? `Synopsis: ${clip(c.synopsis, 600)}` : "",
      c.submission_requirements ? `Requirements: ${clip(c.submission_requirements, 300)}` : "",
    ].filter(Boolean).join("\n");

    // deno-lint-ignore no-explicit-any
    const roles = (c.roles || []) as any[];
    // deno-lint-ignore no-explicit-any
    const tasks: (() => Promise<void>)[] = [];
    // deno-lint-ignore no-explicit-any
    const out: any[] = [];

    for (const r of roles) {
      const range = parseRange(r.age_range);
      const counts = { already_applied: 0, opted_out: 0, no_headshot: 0 };
      // deno-lint-ignore no-explicit-any
      const cands: any[] = [];
      for (const p of talent) {
        if (p.is_minor || (typeof p.age === "number" && p.age < 18)) continue;
        if (!genderAllowed(r.gender, effectiveOpenTo(p))) continue;
        if (!ageAllowed(range, p)) continue;
        // From here on the actor matches age + gender, so exclusions are worth reporting.
        if (applied.has(r.id + ":" + p.id)) { counts.already_applied++; continue; }
        if (p.castslate_submit_opt_in === false) { counts.opted_out++; continue; }
        if (!p.headshot_url) { counts.no_headshot++; continue; }
        cands.push({
          id: p.id, name: p.display_name || "Unnamed", age: p.age ?? null, gender: p.gender || "",
          location: p.location || "", headshot: p.headshot_url, premium: p.membership_status === "active",
          fit: geminiKey ? "pending" : "unrated", reason: "",
          _facts: [
            `age ${p.age ?? "?"}${p.age_range ? " (plays " + p.age_range + ")" : ""}`,
            p.gender ? "gender " + p.gender : "",
            p.location ? "in " + p.location : "",
            p.ethnicity ? "ethnicity " + clip(p.ethnicity, 40) : "",
            p.height ? "height " + p.height : "", p.body_type ? "build " + p.body_type : "",
            p.hair ? "hair " + p.hair : "", p.union_status ? "union " + p.union_status : "",
            p.casting_types?.length || p.casting_type_other ? "types: " + clip([...(p.casting_types || []), p.casting_type_other].filter(Boolean), 160) : "",
            p.talent_types?.length ? "work: " + clip(p.talent_types, 80) : "",
            p.skills?.length ? "skills: " + clip(p.skills, 160) : "",
            p.training ? "training: " + clip(p.training, 120) : "",
            p.credits ? "credits: " + clip(p.credits, 200) : "",
            p.bio ? "bio: " + clip(p.bio, 220) : "",
          ].filter(Boolean).join("; "),
        });
      }
      const roleCtx = [
        castingCtx,
        `\nROLE: ${r.name}${r.role_type ? " (" + r.role_type + ")" : ""}`,
        `Gender: ${r.gender || "any"} · Age: ${r.age_range || "any"}${r.ethnicity ? " · Ethnicity: " + r.ethnicity : ""}`,
        `Description: ${clip(r.description, 900) || "(none given)"}`,
      ].join("\n");
      if (geminiKey) {
        for (let k = 0; k < cands.length; k += CHUNK) {
          const chunk = cands.slice(k, k + CHUNK);
          tasks.push(async () => {
            const list = chunk.map((x, j) => `${j}: ${x._facts}`).join("\n");
            const res = await callGemini(geminiKey, roleCtx + "\n\nACTORS:\n" + list);
            if (!res) { chunk.forEach((x) => { x.fit = "unrated"; }); return; }
            const byI = new Map(res.map((x) => [Number(x.i), x]));
            chunk.forEach((x, j) => {
              const g = byI.get(j);
              const fit = String(g?.fit || "").toLowerCase();
              x.fit = ["strong", "good", "possible", "no"].includes(fit) ? fit : "unrated";
              x.reason = typeof g?.reason === "string" ? g.reason.slice(0, 160) : "";
            });
          });
        }
      }
      out.push({ id: r.id, name: r.name, description: r.description || "", age_range: r.age_range || "", gender: r.gender || "", ethnicity: r.ethnicity || "", candidates: cands, counts });
    }

    await pool(tasks, CONCURRENCY);

    const ORDER: Record<string, number> = { strong: 0, good: 1, possible: 2, unrated: 3, no: 4, pending: 3 };
    let aiFailures = 0;
    for (const r of out) {
      // deno-lint-ignore no-explicit-any
      r.candidates.forEach((x: any) => { if (x.fit === "pending") x.fit = "unrated"; if (x.fit === "unrated") aiFailures++; delete x._facts; });
      // deno-lint-ignore no-explicit-any
      r.candidates.sort((a: any, b: any) => (ORDER[a.fit] - ORDER[b.fit]) || a.name.localeCompare(b.name));
    }

    return json({
      casting: { id: c.id, title: c.title, type: c.type, location: c.shoot_location || c.location, deadline: c.deadline, cd: cd?.company_name || cd?.display_name || "" },
      roles: out,
      pool: talent.length,
      ai: !!geminiKey,
      ai_unrated: aiFailures,
    });
  } catch (e) {
    console.error("[cs-match] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

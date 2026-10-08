// set-roles — Supabase Edge Function (2026-10-08)
//
// Backs castslate.com/set-roles, the one-question "Which roles should we show
// you?" page linked from the premium-upsell email for actors with no gender on
// file. No login: the link carries ?u=<user id>&t=<HMAC of the id> (see
// _shared/role-gender.ts rolesLinkToken), so it works only for the person it was
// mailed to and can change ONLY profiles.authentic_genders. The profiles_stats_sync
// trigger derives open_to_role_genders (what every matcher reads) from it.
//
// POST { action:"get",  u, t }          → { ok, first_name, roles }
// POST { action:"save", u, t, roles[] } → { ok, roles }
// Bad/forged link → 403 { error:"invalid_link" }.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rolesLinkToken, loadRolesLinkSecret } from "../_shared/role-gender.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Same values as AUTHENTIC_OPTS in swipecast-full.jsx.
const ALLOWED = ["Woman", "Transgender Woman", "Man", "Transgender Man", "Nonbinary"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const res = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "Not found" }, 404);
  try {
    const body = await req.json().catch(() => ({}));
    const u = String(body.u ?? "").trim();
    const t = String(body.t ?? "").trim();
    if (!UUID.test(u) || !t) return res({ error: "invalid_link" }, 403);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const secret = await loadRolesLinkSecret(sb);
    if (!secret) return res({ error: "unavailable" }, 503);
    if (!sameString(await rolesLinkToken(secret, u), t)) return res({ error: "invalid_link" }, 403);

    const { data: p } = await sb.from("profiles").select("id,display_name,user_type,authentic_genders").eq("id", u).maybeSingle();
    if (!p || !["talent", "actor"].includes(p.user_type)) return res({ error: "invalid_link" }, 403);

    if (body.action === "get") {
      const first = String(p.display_name ?? "").trim().split(/\s+/)[0] || "";
      return res({ ok: true, first_name: first, roles: Array.isArray(p.authentic_genders) ? p.authentic_genders : [] });
    }

    if (body.action === "save") {
      const roles = Array.isArray(body.roles) ? [...new Set(body.roles.map(String))].filter((r) => ALLOWED.includes(r)) : [];
      if (!roles.length) return res({ error: "pick_one" }, 400);
      const { data, error } = await sb.from("profiles").update({ authentic_genders: roles }).eq("id", u).select("authentic_genders").single();
      if (error) { console.error("[set-roles] save failed", error.message); return res({ error: "save_failed" }, 500); }
      return res({ ok: true, roles: data?.authentic_genders ?? roles });
    }

    return res({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[set-roles]", e);
    return res({ error: "server_error" }, 500);
  }
});

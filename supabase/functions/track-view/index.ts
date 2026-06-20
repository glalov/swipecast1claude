// track-view — Supabase Edge Function
// Public, lightweight pageview beacon. Called by the SPA on each route change.
// Inserts one row into page_views. No auth (it's a public analytics beacon);
// basic length caps guard against abuse.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const cap = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : null);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await sb.from("page_views").insert({
      path: cap(body.path, 300),
      page: cap(body.page, 80),
      referrer: cap(body.referrer, 300),
      session_id: cap(body.session_id, 60),
      is_logged_in: body.is_logged_in === true,
      user_agent: cap(req.headers.get("user-agent"), 300),
    });
  } catch (_) { /* never block the client */ }
  // 204-style ack; keep tiny
  return new Response("ok", { headers: cors });
});

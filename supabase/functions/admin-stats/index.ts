// admin-stats — Supabase Edge Function
// Returns aggregate dashboard metrics for CastSlate admins.
// Auth: POST { secret } where secret === SUPABASE_SERVICE_ROLE_KEY (or ADMIN_CAMPAIGN_SECRET).
// NOTE: real site traffic (pageviews/visitors) is NOT stored in the DB — that lives in
//       Vercel Analytics / Google Analytics. "casting_views" here is in-app engagement only.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_SECRET         = Deno.env.get("ADMIN_CAMPAIGN_SECRET") ?? "cmpn_9e872b254fab6297129ac7ee95c021831a2163dd1f7a9906";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const res = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { secret } = await req.json().catch(() => ({}));
    if (!secret || (secret !== SUPABASE_SERVICE_KEY && secret !== ADMIN_SECRET)) return res({ error: "Unauthorized" }, 401);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const P = "profiles";
    const headCount = async (build: (q: any) => any) => {
      let q = sb.from(P).select("*", { count: "exact", head: true });
      q = build(q);
      const { count } = await q;
      return count ?? 0;
    };
    const since = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

    const [
      total, talent, cds, admins,
      freeMembers, premiumMembers, paidSubs, planMonthly, planYearly,
      stripeCustomers, signups7, signups30, signups1,
    ] = await Promise.all([
      headCount(q => q),
      headCount(q => q.in("user_type", ["talent", "actor"])),
      headCount(q => q.in("user_type", ["cd", "producer", "studio"])),
      headCount(q => q.in("user_type", ["admin", "super_admin"])),
      headCount(q => q.eq("membership_status", "free")),
      headCount(q => q.eq("membership_status", "active")),
      headCount(q => q.eq("subscription_status", "active")),
      headCount(q => q.eq("plan_type", "monthly")),
      headCount(q => q.eq("plan_type", "yearly")),
      headCount(q => q.not("stripe_customer_id", "is", null)),
      headCount(q => q.gt("created_at", since(7))),
      headCount(q => q.gt("created_at", since(30))),
      headCount(q => q.gt("created_at", since(1))),
    ]);

    const { count: unsubscribes } = await sb.from("email_unsubscribes").select("*", { count: "exact", head: true });
    const { count: castingViews } = await sb.from("recently_viewed_castings").select("*", { count: "exact", head: true });
    const { count: openCastings } = await sb.from("castings").select("*", { count: "exact", head: true }).eq("status", "open").eq("published", true);

    // Campaigns + per-campaign progress
    const { data: camps } = await sb.from("email_campaigns").select("id,name,subject,status,total_recipients,sent_count,failed_count,created_at").order("created_at", { ascending: false }).limit(20);
    const campaigns = [];
    for (const c of camps || []) {
      const cnt = async (st: string) => (await sb.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", st)).count ?? 0;
      const [queued, sent, failed, skipped] = await Promise.all([cnt("queued"), cnt("sent"), cnt("failed"), cnt("skipped_unsub")]);
      campaigns.push({ ...c, queued, sent, failed, skipped });
    }

    return res({
      users: { total, talent, casting_directors: cds, admins,
               free_members: freeMembers, premium_members: premiumMembers,
               paid_subscriptions: paidSubs, plan_monthly: planMonthly, plan_yearly: planYearly,
               stripe_customers: stripeCustomers,
               signups_today: signups1, signups_7d: signups7, signups_30d: signups30 },
      engagement: { open_castings: openCastings, casting_views: castingViews },
      email: { unsubscribes: unsubscribes ?? 0 },
      campaigns,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return res({ error: String(e) }, 500);
  }
});

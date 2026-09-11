// stripe-ban-cancel — stops billing when an admin bans or deletes an account.
//
// Terms of Service Addendum Y §5(c) promises that a terminated account "will not
// be charged for any later billing period". Before this existed, a ban only set
// profiles.banned and the Stripe subscription kept renewing.
//
// Called by admin_set_user_banned (on ban) and admin_delete_profile via pg_net:
//   POST { secret, user_id, subscription_id, customer_id, action }
// verify_jwt=false; gated by app_secrets.ban_cancel_secret.
//
// Cancels immediately with no proration and no refund (Addendum Y §5(a) —
// remaining paid time is forfeited). Cancels the stored subscription AND any
// other live subscription on the customer, so a stale stripe_subscription_id
// can't leave a renewal running. stripe-webhook's customer.subscription.deleted
// handler then flips the profile to free.
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: "Bad request" }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: secretRow } = await admin.from("app_secrets").select("value").eq("key", "ban_cancel_secret").maybeSingle();
  if (!secretRow?.value || !body?.secret || body.secret !== secretRow.value) return json({ error: "Unauthorized" }, 401);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "Stripe not configured" }, 503);
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" as any });

  const subId: string | null = body.subscription_id || null;
  const customerId: string | null = body.customer_id || null;
  const ids = new Set<string>();

  if (subId) {
    try {
      const s = await stripe.subscriptions.retrieve(subId);
      if (LIVE.has(s.status)) ids.add(s.id);
    } catch (e) {
      console.warn(`stored subscription ${subId} not retrievable:`, (e as Error).message);
    }
  }
  if (customerId) {
    try {
      const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
      for (const s of list.data) if (LIVE.has(s.status)) ids.add(s.id);
    } catch (e) {
      console.warn(`customer ${customerId} subscriptions not listable:`, (e as Error).message);
    }
  }

  const canceled: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      await stripe.subscriptions.cancel(id, { prorate: false, invoice_now: false });
      canceled.push(id);
    } catch (e) {
      failed.push({ id, error: (e as Error).message });
    }
  }

  console.log(`stripe-ban-cancel ${body.action || "?"} user=${body.user_id} canceled=${JSON.stringify(canceled)} failed=${JSON.stringify(failed)}`);
  return json({ ok: failed.length === 0, canceled, failed }, failed.length ? 502 : 200);
});

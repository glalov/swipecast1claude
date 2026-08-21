// stripe-portal — opens Stripe's hosted Customer Portal for the signed-in member.
//
// The portal is where a member updates their card, downloads invoices, and
// cancels (at period end — configured in Dashboard → Settings → Billing →
// Customer portal, config bpc_1U71m45g7CBS36hgQ79TYvP1). Before this existed
// every one of those requests came through the contact form by hand.
//
// The portal config must stay SAVED in the Stripe Dashboard; if it is ever
// reset, sessions.create() fails with "No configuration provided".
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Billing is not configured yet. Please try again later." }, 503);

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" as any });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, stripe_customer_id")
      .eq("id", user.id)
      .single();

    let customerId: string | null = profile?.stripe_customer_id ?? null;

    // Verify the stored id still resolves (a deleted test customer would 404).
    if (customerId) {
      try {
        const c = await stripe.customers.retrieve(customerId);
        if ((c as any)?.deleted) customerId = null;
      } catch (_) {
        customerId = null;
      }
    }

    // Fall back to matching on email — a few early members paid before the
    // customer id was written back to their profile. Persist what we find so
    // the lookup only ever happens once.
    if (!customerId) {
      const email = profile?.email ?? user.email;
      if (email) {
        const found = await stripe.customers.list({ email, limit: 1 });
        if (found.data.length) {
          customerId = found.data[0].id;
          await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
        }
      }
    }

    // No Stripe customer at all = admin/test override or a free account. There
    // is nothing to manage, and creating an empty customer would only make the
    // portal show a blank page.
    if (!customerId) {
      return json({ error: "No Stripe billing is attached to this account, so there is nothing to manage here." }, 404);
    }

    let body: { return_path?: string } = {};
    try { body = await req.json(); } catch (_) { /* body is optional */ }

    // Only allow same-site return paths — never a caller-supplied host.
    const origin = "https://www.castslate.com";
    const path = typeof body.return_path === "string" && /^\/[A-Za-z0-9\-_/?=&.]*$/.test(body.return_path)
      ? body.return_path
      : "/account-settings";

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}${path}`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[stripe-portal]", (e as any)?.message ?? e);
    return json({ error: "Could not open the billing portal. Please try again, or contact support." }, 500);
  }
});

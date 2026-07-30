import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Keep in sync with CHECKOUT_CONSENT_VERSION / checkoutConsentText in the app.
const CONSENT_VERSION = "2026-07-30";

// FLAT PRICING. Every plan renews at exactly the price paid — there is no
// introductory rate on any term, and no coupon is attached at checkout.
//
// PLAN_RENEWAL must stay equal to PLAN_PRICE. If a future plan ever charges
// less for the first term, the higher renewal price AND its date have to be
// disclosed before payment — consentText() below already handles that case,
// but the app's plan cards would need to say it too.
//
// These figures are duplicated in MEMBERSHIP_PLANS in swipecast-full.jsx.
// Change both together or the consent record will not match what was charged.
const PLAN_PRICE: Record<string, number> = { monthly: 19.95, six_month: 89.70, yearly: 99 };
const PLAN_RENEWAL: Record<string, number> = { monthly: 19.95, six_month: 89.70, yearly: 99 };
const PLAN_MONTHS: Record<string, number> = { monthly: 1, six_month: 6, yearly: 12 };

function consentText(planKey: string): string {
  const total = PLAN_PRICE[planKey] ?? 0;
  const renewal = PLAN_RENEWAL[planKey] ?? total;
  const months = PLAN_MONTHS[planKey] ?? 1;
  const term = months > 1 ? ` today for ${months} months` : ` today`;
  const every = months === 1 ? "month" : months === 12 ? "year" : "6 months";
  const renewSentence = renewal > total
    ? ` This is a discounted introductory price; the membership then renews automatically at $${renewal.toFixed(2)} per ${every} until you cancel.`
    : ` The membership renews automatically at $${total.toFixed(2)} per ${every} — the same price — until you cancel.`;
  return `By continuing to checkout, you authorize CastSlate to charge your payment method $${total.toFixed(2)}${term}.${renewSentence} You confirm you have read and agree to CastSlate's Terms of Service and Privacy Policy, that you are at least 18 years old, and that fees are non-refundable except where required by law.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured on the server yet. Please try again later." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" as any });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.slice(7);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Real client IP + user agent for dispute evidence (captured server-side).
    const clientIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const userAgent = req.headers.get("user-agent") ?? null;

    let body: { type?: string; plan_key?: string; class_id?: string; class_title?: string; class_price?: number };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { type, plan_key, class_id, class_title, class_price } = body;

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, display_name, stripe_customer_id")
      .eq("id", user.id)
      .single();

    let customerId: string | undefined = profile?.stripe_customer_id ?? undefined;

    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (_) {
        customerId = undefined;
        await supabase.from("profiles").update({ stripe_customer_id: null }).eq("id", user.id);
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email ?? user.email,
        name: profile?.display_name ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const origin = "https://www.castslate.com";
    let session: Stripe.Checkout.Session;

    if (type === "premium") {
      // Map plan_key to its price ID env var.
      // Falls back to STRIPE_ACTOR_PREMIUM_PRICE_ID for legacy / monthly-only configs.
      const PRICE_IDS: Record<string, string | undefined> = {
        monthly:   Deno.env.get("STRIPE_PRICE_MONTHLY")   ?? Deno.env.get("STRIPE_ACTOR_PREMIUM_PRICE_ID"),
        six_month: Deno.env.get("STRIPE_PRICE_SIX_MONTH") ?? Deno.env.get("STRIPE_ACTOR_PREMIUM_PRICE_ID"),
        yearly:    Deno.env.get("STRIPE_PRICE_ANNUAL")    ?? Deno.env.get("STRIPE_ACTOR_PREMIUM_PRICE_ID"),
      };

      const resolvedKey = (plan_key && plan_key in PRICE_IDS) ? plan_key : "monthly";
      const priceId = PRICE_IDS[resolvedKey];

      if (!priceId) {
        return new Response(
          JSON.stringify({ error: "Premium membership price not configured yet. Please try again later." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fail with a clear, actionable message when a price ID points at an
      // archived price. Stripe's own error ("The price specified is inactive")
      // gives no hint about WHICH env var is stale, which cost real debugging
      // time when the welcome-offer prices were archived.
      try {
        const p = await stripe.prices.retrieve(priceId);
        if (!p.active) {
          const envName = resolvedKey === "yearly" ? "STRIPE_PRICE_ANNUAL"
            : resolvedKey === "six_month" ? "STRIPE_PRICE_SIX_MONTH" : "STRIPE_PRICE_MONTHLY";
          console.error(`[stripe-checkout] ${envName} points at archived price ${priceId}`);
          return new Response(
            JSON.stringify({ error: "This plan is temporarily unavailable. Please try another plan or contact support." }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (e) {
        console.error(`[stripe-checkout] could not verify price ${priceId}:`, (e as any)?.message ?? e);
      }

      // No coupons: pricing is flat, so the promo-code box is always offered.
      // (Stripe forbids `discounts` together with `allow_promotion_codes`.)
      session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}&type=premium`,
        cancel_url: `${origin}/membership`,
        allow_promotion_codes: true,
        metadata: {
          user_id: user.id,
          type: "premium_subscription",
          plan_key: resolvedKey,
        },
        subscription_data: {
          metadata: { user_id: user.id, plan_key: resolvedKey },
        },
      });

      // Server-side consent record (authoritative) — links the exact Stripe
      // checkout session to the user, IP, and disclosure they agreed to.
      // Never block checkout if this insert fails.
      try {
        await supabase.from("checkout_consents").insert({
          user_id: user.id,
          plan_key: resolvedKey,
          price: PLAN_PRICE[resolvedKey] ?? null,
          policy_version: CONSENT_VERSION,
          policy_text: consentText(resolvedKey),
          ip: clientIp,
          user_agent: userAgent,
          source: "server",
          session_id: session.id,
        });
      } catch (e) {
        console.error("consent log (server) failed:", (e as any)?.message ?? e);
      }

    } else if (type === "class") {
      if (!class_id || typeof class_price !== "number" || class_price <= 0) {
        return new Response(
          JSON.stringify({ error: "Invalid class details" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: class_title ?? "Acting Class" },
            unit_amount: Math.round(class_price * 100),
          },
          quantity: 1,
        }],
        success_url: `${origin}/classes?class_id=${encodeURIComponent(class_id)}&payment=success`,
        cancel_url: `${origin}/classes?class_id=${encodeURIComponent(class_id)}`,
        metadata: {
          user_id: user.id,
          class_id,
          type: "class_payment",
        },
      });

    } else {
      return new Response(
        JSON.stringify({ error: "Invalid checkout type." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    const message = err?.message ?? "An unexpected error occurred.";
    console.error("stripe-checkout error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

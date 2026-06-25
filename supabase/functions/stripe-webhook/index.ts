import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Resolve the CastSlate profile id for an incoming Stripe event.
// We never want activation to depend on a single source: prefer the
// user_id we stamp into metadata at checkout, but fall back to looking
// the profile up by stripe_customer_id / stripe_subscription_id so a
// paid user is always matched even if metadata is missing.
async function resolveUserId(opts: {
  metaUserId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}): Promise<string | null> {
  if (opts.metaUserId) return opts.metaUserId;

  if (opts.subscriptionId) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_subscription_id", opts.subscriptionId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  if (opts.customerId) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", opts.customerId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeKey || !webhookSecret) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return new Response("Server configuration error", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" as any });

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response(`Webhook Error: ${err instanceof Error ? err.message : "Unknown"}`, { status: 400 });
  }

  console.log(`[stripe-webhook] Processing: ${event.type}`);

  try {
    switch (event.type) {

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = await resolveUserId({
          metaUserId: session.metadata?.user_id,
          customerId: session.customer as string | null,
          subscriptionId: session.subscription as string | null,
        });
        if (!userId) { console.warn("No user match for checkout session"); break; }

        if (session.metadata?.type === "premium_subscription" && session.mode === "subscription") {
          const planKey = session.metadata?.plan_key || "monthly";
          const { error } = await supabase
            .from("profiles")
            .update({
              membership_status: "active",
              subscription_status: "active",
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              plan_type: planKey,
              premium_started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
          if (error) console.error("Failed to activate premium:", error);
          else console.log(`Premium activated for user: ${userId}, plan: ${planKey}`);

          // One-time "Welcome to Premium" email. Guarded by premium_welcome_sent_at
          // so renewals / re-subscribes never re-send it. Fire-and-forget; non-fatal.
          try {
            const { data: prof } = await supabase
              .from("profiles").select("premium_welcome_sent_at").eq("id", userId).maybeSingle();
            if (!prof?.premium_welcome_sent_at) {
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to_user_id: userId, type: "premium_welcome" }),
              });
              await supabase.from("profiles")
                .update({ premium_welcome_sent_at: new Date().toISOString() })
                .eq("id", userId);
              console.log(`Premium welcome email dispatched for user: ${userId}`);
            }
          } catch (e) {
            console.error("Premium welcome email failed (non-fatal):", e);
          }

        } else if (session.metadata?.type === "class_payment" && session.mode === "payment") {
          const classId = session.metadata?.class_id;
          if (classId) {
            const { error } = await supabase
              .from("class_booking_requests")
              .update({
                status: "paid",
                stripe_session_id: session.id,
                payment_status: "paid",
              })
              .eq("user_id", userId)
              .eq("class_id", classId)
              .in("status", ["approved", "payment_pending"]);
            if (error) console.error("Failed to update class payment:", error);
            else console.log(`Class payment confirmed user:${userId} class:${classId}`);
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId({
          metaUserId: sub.metadata?.user_id,
          customerId: sub.customer as string | null,
          subscriptionId: sub.id,
        });
        if (!userId) { console.warn("No user match for subscription event"); break; }

        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        const planKey = sub.metadata?.plan_key || "monthly";

        // Always keep subscription_status / ids / period in sync.
        const updates: Record<string, unknown> = {
          subscription_status: sub.status,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer as string,
          plan_type: planKey,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        };

        // membership_status is the gate the whole app reads. Only move it on
        // DEFINITIVE states, so transient / out-of-order events can never
        // clobber a paid member back to "free":
        //   - active / trialing            -> grant premium
        //   - canceled / unpaid            -> revoke premium
        //   - incomplete / past_due / etc. -> leave membership untouched
        if (sub.status === "active" || sub.status === "trialing") {
          updates.membership_status = "active";
        } else if (sub.status === "canceled" || sub.status === "unpaid") {
          updates.membership_status = "free";
        }

        const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
        if (error) console.error("Failed to update subscription:", error);
        else console.log(`Subscription ${sub.status} for user: ${userId}, plan: ${planKey}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId({
          metaUserId: sub.metadata?.user_id,
          customerId: sub.customer as string | null,
          subscriptionId: sub.id,
        });
        if (!userId) break;

        const { error } = await supabase
          .from("profiles")
          .update({
            membership_status: "free",
            subscription_status: "canceled",
            stripe_subscription_id: null,
            current_period_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        if (error) console.error("Failed to cancel subscription:", error);
        else console.log(`Subscription canceled for user: ${userId}`);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = await resolveUserId({
          metaUserId: sub.metadata?.user_id,
          customerId: sub.customer as string | null,
          subscriptionId: sub.id,
        });
        if (!userId) break;
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        const planKey = sub.metadata?.plan_key || "monthly";
        await supabase
          .from("profiles")
          .update({
            membership_status: "active",
            subscription_status: "active",
            stripe_customer_id: sub.customer as string,
            stripe_subscription_id: sub.id,
            plan_type: planKey,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        console.log(`Invoice payment succeeded for user: ${userId}, plan: ${planKey}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = await resolveUserId({
          metaUserId: sub.metadata?.user_id,
          customerId: sub.customer as string | null,
          subscriptionId: sub.id,
        });
        if (!userId) break;
        await supabase
          .from("profiles")
          .update({
            subscription_status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        console.log(`Invoice payment failed for user: ${userId}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

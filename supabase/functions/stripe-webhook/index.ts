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

// The date a member's paid access actually runs to.
//
// Stripe moved `current_period_end` off the subscription object and onto the
// subscription ITEM in its newer API versions. Reading only the top-level
// field silently wrote NULL for every member, which left the settings page
// with no renewal date and no way to tell someone when their access ends.
// Read both, newest shape first, so this stays correct across versions.
function resolvePeriodEnd(sub: Stripe.Subscription): string | null {
  const secs =
    (sub as any).current_period_end ??
    (sub as any).items?.data?.[0]?.current_period_end ??
    null;
  return secs ? new Date(secs * 1000).toISOString() : null;
}

// The recurring amount THIS member is actually billed, in dollars.
//
// A Stripe subscription is pinned to the price it was created with, so members
// who joined on older rates keep them. The app's plan table only holds current
// list pricing, so it must never be used to tell an existing member what they
// pay — store the real figure and read that instead.
function resolvePlanPrice(sub: Stripe.Subscription): number | null {
  const cents = (sub as any).items?.data?.[0]?.price?.unit_amount;
  return typeof cents === "number" ? cents / 100 : null;
}

// ── Non-payment grace period ────────────────────────────────────────────────
// A failed charge does NOT revoke premium on its own — Stripe retries for days
// and an out-of-order event must never knock a paying member down to free. What
// it does is start the clock: past_due_since is stamped once, and the hourly
// enforce_past_due_downgrades() sweep flips the member to free (and hides their
// gallery photos/videos via premium_locked_at) on day 4 if it is still unpaid.
//
// Stamp ONCE per streak: `.is("past_due_since", null)` means Stripe's repeated
// retry failures can't keep pushing the deadline out.
async function stampPastDue(userId: string): Promise<void> {
  await supabase
    .from("profiles")
    .update({ past_due_since: new Date().toISOString() })
    .eq("id", userId)
    .is("past_due_since", null);
}

// The other half: any confirmed payment clears the streak AND the lock, so the
// member's media comes back untouched. Always merged into the same update that
// sets membership_status='active' — never a separate write that could half-apply.
const PAYMENT_CLEARED = {
  past_due_since: null,
  premium_locked_at: null,
};

// One-time "Welcome to Premium" email.
//
// send-notification-email is no longer anonymous — it requires the service role
// key, the shared notify secret, or a user JWT. This call used to send no
// Authorization header at all, so every welcome was rejected with 401 while the
// webhook still stamped premium_welcome_sent_at, permanently marking the member
// as "welcomed" without a single email going out. Two rules keep that from
// recurring: send the service-role credential, and only stamp the guard when the
// email function confirms it actually sent (or deliberately skipped).
async function sendPremiumWelcome(userId: string): Promise<void> {
  const { data: prof } = await supabase
    .from("profiles").select("premium_welcome_sent_at").eq("id", userId).maybeSingle();
  if (prof?.premium_welcome_sent_at) return;

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ to_user_id: userId, type: "premium_welcome" }),
  });

  const payload = await res.json().catch(() => ({} as any));
  const outcome = String((payload as any)?.results?.email ?? "");

  // A hard failure (401/500) or a provider error must NOT burn the guard —
  // leaving it null means the next paid event can still deliver the welcome.
  if (!res.ok || outcome.startsWith("error:")) {
    console.error(
      `[stripe-webhook] premium welcome NOT sent for ${userId} — status ${res.status}, outcome "${outcome || JSON.stringify(payload)}"; guard left unset for retry`
    );
    return;
  }

  await supabase.from("profiles")
    .update({ premium_welcome_sent_at: new Date().toISOString() })
    .eq("id", userId);
  console.log(`[stripe-webhook] premium welcome ${outcome || "sent"} for user: ${userId}`);
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
              ...PAYMENT_CLEARED,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
          if (error) console.error("Failed to activate premium:", error);
          else console.log(`Premium activated for user: ${userId}, plan: ${planKey}`);

          // Guarded by premium_welcome_sent_at so renewals / re-subscribes never
          // re-send it. Non-fatal: a failed email must never fail the webhook.
          try {
            await sendPremiumWelcome(userId);
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

        const periodEnd = resolvePeriodEnd(sub);
        // NO "monthly" fallback here. This runs on every subscription event, so
        // a default would silently rewrite a yearly member to monthly the first
        // time an event arrived without plan_key metadata.
        const planKey = sub.metadata?.plan_key || null;

        // A customer can own more than one subscription (an abandoned or
        // declined attempt sitting alongside the live one), and Stripe does not
        // guarantee webhook ordering. Both let a stale or transient event
        // clobber a paying row — that is how paid members ended up stamped
        // "incomplete". Read what we hold before overwriting it.
        const { data: held } = await supabase
          .from("profiles")
          .select("subscription_status, stripe_subscription_id")
          .eq("id", userId)
          .maybeSingle();
        const heldSub = held?.stripe_subscription_id || null;
        const heldIsPaid = ["active", "trialing", "past_due"].includes(held?.subscription_status || "");
        const eventIsPaid = sub.status === "active" || sub.status === "trialing";

        // Event describes a DIFFERENT subscription than the one on file, and
        // the one on file is paid. Only a paid event may take over the record;
        // a dead sibling must not drag the live subscription's id/plan with it.
        if (heldSub && heldSub !== sub.id && heldIsPaid && !eventIsPaid) {
          console.log(`[stripe-webhook] Ignoring ${sub.status} for stale sub ${sub.id}; profile holds ${heldSub}`);
          break;
        }
        // Same subscription, but a transient pre-payment status arriving after
        // checkout.session.completed already confirmed the money. Keep what we
        // have rather than downgrading a paid member to "incomplete".
        const staleIncomplete = sub.status === "incomplete" && heldIsPaid;

        // Always keep subscription_status / ids / period in sync.
        const updates: Record<string, unknown> = {
          subscription_status: staleIncomplete ? held!.subscription_status : sub.status,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer as string,
          current_period_end: periodEnd,
          // Scheduled cancellation. Stripe keeps status "active" until the
          // period actually ends, so this flag is the ONLY way the app can
          // tell "renews on this date" from "access ends on this date".
          cancel_at_period_end: !!sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        };
        if (planKey) updates.plan_type = planKey;
        const planPrice = resolvePlanPrice(sub);
        if (planPrice !== null) updates.plan_price = planPrice;

        // membership_status is the gate the whole app reads. Only move it on
        // DEFINITIVE states, so transient / out-of-order events can never
        // clobber a paid member back to "free":
        //   - active / trialing            -> grant premium (and clear any lock)
        //   - canceled / unpaid            -> revoke premium
        //   - incomplete / past_due / etc. -> leave membership untouched; the
        //     3-day grace sweep decides, not this event
        if (sub.status === "active" || sub.status === "trialing") {
          updates.membership_status = "active";
          Object.assign(updates, PAYMENT_CLEARED);
        } else if (sub.status === "canceled" || sub.status === "unpaid") {
          updates.membership_status = "free";
          // "unpaid" is Stripe giving up on retries — that IS non-payment, so
          // the media lock applies. A plain cancel is not, and leaves it alone.
          if (sub.status === "unpaid") {
            updates.premium_locked_at = new Date().toISOString();
          }
        }

        const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
        if (error) console.error("Failed to update subscription:", error);
        else console.log(`Subscription ${sub.status} for user: ${userId}, plan: ${planKey}`);

        // Start the 3-day clock the first time this streak goes unpaid.
        if (sub.status === "past_due" || sub.status === "unpaid") {
          await stampPastDue(userId);
        }

        // Safety net for the welcome email: if checkout.session.completed was
        // missed, or its send failed, an active subscription still triggers it
        // exactly once (the guard inside sendPremiumWelcome keeps it one-time).
        if (updates.membership_status === "active") {
          try {
            await sendPremiumWelcome(userId);
          } catch (e) {
            console.error("Premium welcome email failed (non-fatal):", e);
          }
        }
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
            cancel_at_period_end: false,
            // The streak is over (the subscription is gone), but premium_locked_at
            // is left as-is: someone dropped for non-payment stays locked until
            // they actually pay, rather than being un-locked by the cancellation.
            past_due_since: null,
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
        const periodEnd = resolvePeriodEnd(sub);
        // Same rule as the subscription handler: no "monthly" fallback. This is
        // the renewal path, so a default here would flip a yearly member to
        // monthly on the very invoice that proves they paid for a year.
        const planKey = sub.metadata?.plan_key || null;
        await supabase
          .from("profiles")
          .update({
            membership_status: "active",
            subscription_status: "active",
            stripe_customer_id: sub.customer as string,
            stripe_subscription_id: sub.id,
            ...(planKey ? { plan_type: planKey } : {}),
            current_period_end: periodEnd,
            cancel_at_period_end: !!sub.cancel_at_period_end,
            ...(resolvePlanPrice(sub) !== null ? { plan_price: resolvePlanPrice(sub) } : {}),
            // Payment landed: end the non-payment streak and unlock the member's
            // photos/videos in the same write that restores premium.
            ...PAYMENT_CLEARED,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        console.log(`Invoice payment succeeded for user: ${userId}, plan: ${planKey} (premium restored, media unlocked)`);
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
        // Premium is NOT revoked here — the member gets 3 full days. Stamping
        // the start of the streak is what hands that decision to the sweep.
        await stampPastDue(userId);
        console.log(`Invoice payment failed for user: ${userId} — grace period started`);
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

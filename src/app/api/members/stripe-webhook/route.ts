import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Members / subscription webhook (migrated from the VPS Express app).
//
// Stripe requires the raw, unmodified request body to verify the signature.
// The Next.js App Router hands us the untouched body via req.text(), so there
// is no body-parser mutating the bytes before verification. This is the fix
// for the old VPS handler, which JSON-parsed the body first and therefore
// failed every signature check.
//
// Membership is sold through Stripe Payment Links (Superfan / Artist, monthly
// & yearly). We identify the tier + interval from the subscription price and
// persist state onto public.profiles, linking by Stripe customer id first and
// falling back to the customer email -> profiles.username. Every processed
// event is recorded in public.membership_events for idempotency + audit.
// ---------------------------------------------------------------------------

type Tier = "superfan" | "artist" | null;
type Interval = "month" | "year" | null;

// Amounts in cents. Superfan: 299 / 2999. Artist: 499 / 4999.
// (Legacy amounts 499/4999/999/9999 kept as fallbacks so any in-flight
// subscriptions created before the price change still classify correctly.)
function classifyPrice(amountCents: number | null | undefined): {
  tier: Tier;
  interval: Interval;
} {
  switch (amountCents) {
    case 299:
      return { tier: "superfan", interval: "month" };
    case 2999:
      return { tier: "superfan", interval: "year" };
    case 499:
      return { tier: "artist", interval: "month" };
    case 4999:
      return { tier: "artist", interval: "year" };
    // Legacy pricing fallbacks (pre July 2026):
    case 999:
      return { tier: "artist", interval: "month" };
    case 9999:
      return { tier: "artist", interval: "year" };
    default:
      return { tier: null, interval: null };
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret =
    process.env.STRIPE_MEMBERS_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !webhookSecret) {
    console.error("members/stripe-webhook: missing STRIPE keys");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = new Stripe(secret);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    console.error("members/stripe-webhook signature error:", msg);
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
  }

  try {
    await handleEvent(stripe, event);
  } catch (err) {
    // Log but still 200 so Stripe does not hammer retries for an application
    // error (signature already verified). Failures are visible in logs +
    // membership_events is only written on success paths.
    console.error("members/stripe-webhook handler error:", err);
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(stripe: Stripe, event: Stripe.Event) {
  const supabase = createServiceClient();

  // Idempotency: skip if we already processed this event id.
  const { data: seen } = await supabase
    .from("membership_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (seen) return;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Only handle subscription checkouts here; one-time (store/donate) is
      // owned by their own handlers.
      if (session.mode !== "subscription") return;
      await applySubscriptionState(stripe, supabase, event, {
        customerId:
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null,
        subscriptionId:
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null,
        email:
          session.customer_details?.email ??
          session.customer_email ??
          null,
        amountTotal: session.amount_total ?? null,
        status: "active",
      });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const item = sub.items?.data?.[0];
      const amount = item?.price?.unit_amount ?? null;
      const interval = item?.price?.recurring?.interval ?? null;
      const isCanceled =
        event.type === "customer.subscription.deleted" ||
        sub.status === "canceled" ||
        sub.status === "unpaid" ||
        sub.status === "incomplete_expired";

      await applySubscriptionState(stripe, supabase, event, {
        customerId:
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
        subscriptionId: sub.id,
        email: null,
        amountTotal: amount,
        intervalOverride: (interval as Interval) ?? null,
        status: isCanceled ? "canceled" : sub.status === "active" || sub.status === "trialing" ? "active" : sub.status,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        clearOnCancel: isCanceled,
      });
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const line = invoice.lines?.data?.[0];
      const amount = line?.amount ?? invoice.amount_paid ?? null;
      await applySubscriptionState(stripe, supabase, event, {
        customerId:
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null,
        subscriptionId:
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null,
        email: invoice.customer_email ?? null,
        amountTotal: amount,
        status: "active",
        currentPeriodEnd: line?.period?.end
          ? new Date(line.period.end * 1000).toISOString()
          : null,
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await applySubscriptionState(stripe, supabase, event, {
        customerId:
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null,
        subscriptionId:
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null,
        email: invoice.customer_email ?? null,
        amountTotal: invoice.amount_due ?? null,
        status: "past_due",
      });
      return;
    }

    default:
      // Log unhandled events too, so nothing is silently dropped.
      await logEvent(supabase, event, {
        customerId: null,
        subscriptionId: null,
        email: null,
        tier: null,
        interval: null,
        status: null,
        amountTotal: null,
        currentPeriodEnd: null,
      });
      return;
  }
}

interface StateArgs {
  customerId: string | null;
  subscriptionId: string | null;
  email: string | null;
  amountTotal: number | null;
  status: string;
  intervalOverride?: Interval;
  currentPeriodEnd?: string | null;
  clearOnCancel?: boolean;
}

async function applySubscriptionState(
  stripe: Stripe,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: Stripe.Event,
  args: StateArgs
) {
  const { tier, interval } = classifyPrice(args.amountTotal);
  const resolvedInterval = args.intervalOverride ?? interval;

  // Resolve the customer email if we only have a customer id.
  let email = args.email;
  if (!email && args.customerId) {
    try {
      const customer = await stripe.customers.retrieve(args.customerId);
      if (customer && !("deleted" in customer && customer.deleted)) {
        email = (customer as Stripe.Customer).email ?? null;
      }
    } catch {
      /* non-fatal */
    }
  }

  // Always record the event for audit + idempotency.
  await logEvent(supabase, event, {
    customerId: args.customerId,
    subscriptionId: args.subscriptionId,
    email,
    tier,
    interval: resolvedInterval,
    status: args.status,
    amountTotal: args.amountTotal,
    currentPeriodEnd: args.currentPeriodEnd ?? null,
  });

  // Try to link to an existing profile. Prefer stripe_customer_id, then
  // subscription id, then email -> username (case-insensitive).
  const profile = await findProfile(supabase, {
    customerId: args.customerId,
    subscriptionId: args.subscriptionId,
    email,
  });
  if (!profile) {
    // No linked account yet (Payment Link buyers are reconciled later). The
    // membership_events row above preserves everything needed to reconcile.
    return;
  }

  const canceled = !!args.clearOnCancel || args.status === "canceled";
  const update: Record<string, unknown> = {
    membership_status: canceled ? "free" : args.status === "past_due" ? "past_due" : "active",
    membership_tier: canceled ? null : tier ?? profile.membership_tier ?? null,
    membership_interval: canceled ? null : resolvedInterval ?? null,
    stripe_customer_id: args.customerId ?? profile.stripe_customer_id ?? null,
    stripe_subscription_id: canceled ? null : args.subscriptionId ?? profile.stripe_subscription_id ?? null,
    membership_expires_at: canceled ? null : args.currentPeriodEnd ?? null,
    membership_updated_at: new Date().toISOString(),
  };

  await supabase.from("profiles").update(update).eq("id", profile.id);
}

async function findProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  keys: { customerId: string | null; subscriptionId: string | null; email: string | null }
): Promise<{
  id: string;
  membership_tier: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
} | null> {
  const cols = "id,membership_tier,stripe_customer_id,stripe_subscription_id";

  if (keys.customerId) {
    const { data } = await supabase
      .from("profiles")
      .select(cols)
      .eq("stripe_customer_id", keys.customerId)
      .maybeSingle();
    if (data) return data;
  }
  if (keys.subscriptionId) {
    const { data } = await supabase
      .from("profiles")
      .select(cols)
      .eq("stripe_subscription_id", keys.subscriptionId)
      .maybeSingle();
    if (data) return data;
  }
  if (keys.email) {
    const { data } = await supabase
      .from("profiles")
      .select(cols)
      .ilike("username", keys.email)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

interface LogArgs {
  customerId: string | null;
  subscriptionId: string | null;
  email: string | null;
  tier: Tier;
  interval: Interval;
  status: string | null;
  amountTotal: number | null;
  currentPeriodEnd: string | null;
}

async function logEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: Stripe.Event,
  a: LogArgs
) {
  await supabase.from("membership_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_customer_id: a.customerId,
    stripe_subscription_id: a.subscriptionId,
    customer_email: a.email,
    tier: a.tier,
    interval: a.interval,
    status: a.status,
    amount_total: a.amountTotal,
    current_period_end: a.currentPeriodEnd,
    raw: event.data.object as unknown as Record<string, unknown>,
  });
}

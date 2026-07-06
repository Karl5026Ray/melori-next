import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyPrice, type Interval, type Tier } from "@/lib/membership-sync";

// Server-only helpers shared by the /welcome onboarding API routes
// (api/welcome/session + api/welcome/complete). Never import into a client
// component — this touches the Stripe secret key and the service-role client.

export interface VerifiedSession {
  ok: true;
  paid: boolean;
  email: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  amountTotal: number | null;
  tier: Tier;
  interval: Interval;
  currentPeriodEnd: string | null;
}

export interface VerifiedSessionError {
  ok: false;
  status: number;
  error: string;
}

// Retrieve a Stripe Checkout Session server-side and extract the fields we need
// to grant a membership. Entitlement is derived from Stripe here, never from
// client-supplied query params. When the session references a subscription we
// pull the subscription's price so the tier is correct even if amount_total is
// unavailable.
export async function verifyCheckoutSession(
  sessionId: string,
): Promise<VerifiedSession | VerifiedSessionError> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return { ok: false, status: 503, error: "Payments are not configured." };
  }
  const trimmed = sessionId.trim();
  if (!trimmed || !trimmed.startsWith("cs_")) {
    return { ok: false, status: 400, error: "Invalid checkout session." };
  }

  const stripe = new Stripe(secret);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(trimmed, {
      expand: ["subscription", "subscription.items.data.price"],
    });
  } catch {
    return { ok: false, status: 404, error: "Checkout session not found." };
  }

  const paid =
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required";

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  const subscription =
    session.subscription && typeof session.subscription !== "string"
      ? (session.subscription as Stripe.Subscription)
      : null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : subscription?.id ?? null;

  // Prefer the subscription price amount; fall back to the session total.
  const priceAmount =
    subscription?.items?.data?.[0]?.price?.unit_amount ??
    session.amount_total ??
    null;
  const subInterval =
    (subscription?.items?.data?.[0]?.price?.recurring?.interval as Interval) ??
    null;

  const { tier, interval } = classifyPrice(priceAmount);

  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  return {
    ok: true,
    paid,
    email:
      session.customer_details?.email ?? session.customer_email ?? null,
    customerId,
    subscriptionId,
    amountTotal: priceAmount,
    tier,
    interval: subInterval ?? interval,
    currentPeriodEnd,
  };
}

// Look up an auth user by email using the service-role admin API. Returns the
// user (id + email) or null. Mirrors the pagination approach used by the
// members webhook so behaviour is consistent across the app.
export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const perPage = 200;
  const maxPages = 25;
  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;
    const match = data.users.find(
      (u) => (u.email ?? "").toLowerCase() === target,
    );
    if (match) return { id: match.id, email: match.email ?? target };
    if (data.users.length < perPage) return null;
  }
  return null;
}

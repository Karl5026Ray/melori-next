import Stripe from "stripe";

// Stripe client — used in Phase 2 (payments). Initialized lazily so the
// app builds without a key present in Phase 1.
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

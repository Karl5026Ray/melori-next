import Stripe from "stripe";

// ---------------------------------------------------------------------------
// Stripe account policy during the 2026 forward cutover.
//
// OUTBOUND (checkouts, customers, subscriptions, payment intents, Connect) is
// PRIMARY-ONLY. There is exactly one outbound credential — STRIPE_SECRET_KEY —
// and deliberately no legacy equivalent, so no code path can create anything
// on the old account.
//
// INBOUND (webhook verification) must tolerate BOTH accounts while the legacy
// subscriptions renew. Each Stripe endpoint has its own signing secret, so a
// handler pinned to one secret would 400 every legacy renewal and silently
// strand those members. See webhookSecretCandidates / constructWebhookEvent.
// ---------------------------------------------------------------------------

// Stripe client — used in Phase 2 (payments). Initialized lazily so the
// app builds without a key present in Phase 1.
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Which Stripe account a verified webhook event was signed by. "legacy" is the
// pre-cutover account, which still bills a handful of in-flight subscriptions.
export type StripeAccountOrigin = "primary" | "legacy";

export interface WebhookSecretCandidate {
  origin: StripeAccountOrigin;
  secret: string;
}

export interface VerifiedWebhookEvent {
  event: Stripe.Event;
  origin: StripeAccountOrigin;
}

// Ordered signing secrets to try for a webhook route: primary first, then the
// legacy account's secret if one is configured.
//
// `legacySecret` is intentionally a separate argument rather than read here, so
// each route opts in explicitly — only endpoints the legacy account actually
// posts to should accept legacy signatures.
//
// When no legacy secret is set the result is a single-element list, which makes
// constructWebhookEvent behave identically to a plain constructEvent call.
export function webhookSecretCandidates(
  primarySecret: string | undefined | null,
  legacySecret?: string | undefined | null,
): WebhookSecretCandidate[] {
  const candidates: WebhookSecretCandidate[] = [];
  if (primarySecret) candidates.push({ origin: "primary", secret: primarySecret });
  // Skip a legacy secret identical to the primary — retrying the same secret
  // can only produce the same failure.
  if (legacySecret && legacySecret !== primarySecret) {
    candidates.push({ origin: "legacy", secret: legacySecret });
  }
  return candidates;
}

// Verify a raw webhook body against each candidate secret in turn and return
// the first that validates, along with the account it came from.
//
// Verification always goes through Stripe's own constructEvent, which performs
// the constant-time HMAC comparison and the timestamp-tolerance check. We never
// compare signatures ourselves. Trying a second secret does not weaken this: a
// forged signature fails every candidate exactly as it fails one.
//
// Throws the last error Stripe produced (i.e. the primary account's error when
// nothing validates), so callers surface the same message they do today.
export function constructWebhookEvent(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  candidates: WebhookSecretCandidate[],
): VerifiedWebhookEvent {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return {
        event: stripe.webhooks.constructEvent(rawBody, signature, candidate.secret),
        origin: candidate.origin,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("No Stripe webhook signing secret configured");
}

/* eslint-disable no-console */
//
// scripts/stripe-webhook-secrets.test.ts
//
// VALIDATION TESTS for dual-account Stripe webhook verification
// (webhookSecretCandidates + constructWebhookEvent in src/lib/stripe.ts).
//
// Context: during the 2026 forward cutover the app bills new customers on the
// NEW Stripe account while a handful of subscriptions keep renewing on the OLD
// one. Each account's webhook endpoint has its own signing secret, so
// /api/members/stripe-webhook must accept either. Getting this wrong is not a
// cosmetic bug: every legacy renewal would 400 and those paying members would
// silently lose their entitlements.
//
// These lock in both halves of the contract:
//
//   * an event signed by the PRIMARY secret is accepted, with or without a
//     legacy secret configured
//   * an event signed by the LEGACY secret is accepted ONLY when the legacy
//     secret is configured, and REJECTED when it is not — the fallback must be
//     opt-in, never implicit
//   * a garbage / forged / tampered signature is rejected in every
//     configuration, so widening the accepted set never widens the attack
//     surface
//
// Signatures are produced by Stripe's own generateTestHeaderString and verified
// by Stripe's own constructEvent, so this exercises the real constant-time HMAC
// path rather than a hand-rolled stand-in. No network, no DB.
//
// Run:  npx tsx scripts/stripe-webhook-secrets.test.ts   (also: npm run test:stripe-webhook)

import Stripe from "stripe";
import {
  constructWebhookEvent,
  webhookSecretCandidates,
  type StripeAccountOrigin,
} from "@/lib/stripe";

const PRIMARY_SECRET = "whsec_primary_account_test_secret";
const LEGACY_SECRET = "whsec_legacy_account_test_secret";

// The API key is never used — constructEvent verifies locally.
const stripe = new Stripe("sk_test_unused_by_signature_verification");

const PAYLOAD = JSON.stringify({
  id: "evt_test_renewal",
  object: "event",
  type: "invoice.paid",
  data: { object: { object: "invoice", id: "in_test", amount_paid: 499 } },
});

function sign(payload: string, secret: string): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function run(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// Verify `signature` against the given configuration and report either the
// origin it was attributed to, or "rejected".
function verify(
  signature: string,
  config: { primary?: string | null; legacy?: string | null },
): StripeAccountOrigin | "rejected" {
  const candidates = webhookSecretCandidates(config.primary, config.legacy);
  try {
    return constructWebhookEvent(stripe, PAYLOAD, signature, candidates).origin;
  } catch {
    return "rejected";
  }
}

const primarySigned = sign(PAYLOAD, PRIMARY_SECRET);
const legacySigned = sign(PAYLOAD, LEGACY_SECRET);

run("candidate list is built primary-first and legacy is opt-in", () => {
  assertEq("primary only", webhookSecretCandidates(PRIMARY_SECRET), [
    { origin: "primary", secret: PRIMARY_SECRET },
  ]);
  assertEq(
    "primary then legacy, in that order",
    webhookSecretCandidates(PRIMARY_SECRET, LEGACY_SECRET),
    [
      { origin: "primary", secret: PRIMARY_SECRET },
      { origin: "legacy", secret: LEGACY_SECRET },
    ],
  );
  // An empty-string env var is what Vercel yields for a declared-but-unset
  // variable; it must not become a candidate.
  assertEq(
    "empty legacy secret is ignored",
    webhookSecretCandidates(PRIMARY_SECRET, ""),
    [{ origin: "primary", secret: PRIMARY_SECRET }],
  );
  assertEq(
    "undefined legacy secret is ignored",
    webhookSecretCandidates(PRIMARY_SECRET, undefined),
    [{ origin: "primary", secret: PRIMARY_SECRET }],
  );
  // Retrying an identical secret can only reproduce the same failure.
  assertEq(
    "legacy identical to primary is not duplicated",
    webhookSecretCandidates(PRIMARY_SECRET, PRIMARY_SECRET),
    [{ origin: "primary", secret: PRIMARY_SECRET }],
  );
  assertEq("no secrets at all yields no candidates", webhookSecretCandidates(null), []);
});

run("an event signed with the PRIMARY secret is accepted", () => {
  assertEq(
    "accepted when only the primary secret is configured",
    verify(primarySigned, { primary: PRIMARY_SECRET }),
    "primary",
  );
  assertEq(
    "still accepted, and still attributed to primary, when legacy is also set",
    verify(primarySigned, { primary: PRIMARY_SECRET, legacy: LEGACY_SECRET }),
    "primary",
  );
});

run("an event signed with the LEGACY secret is accepted only when configured", () => {
  assertEq(
    "accepted and attributed to legacy when STRIPE_WEBHOOK_SECRET_LEGACY is set",
    verify(legacySigned, { primary: PRIMARY_SECRET, legacy: LEGACY_SECRET }),
    "legacy",
  );
  // The pre-deploy state, and the post-teardown state. Behaviour here must be
  // byte-for-byte what it is today.
  assertEq(
    "REJECTED when the legacy secret is not set",
    verify(legacySigned, { primary: PRIMARY_SECRET }),
    "rejected",
  );
  assertEq(
    "REJECTED when the legacy secret is set to an empty string",
    verify(legacySigned, { primary: PRIMARY_SECRET, legacy: "" }),
    "rejected",
  );
});

run("a garbage signature is rejected in every configuration", () => {
  const forged = sign(PAYLOAD, "whsec_attacker_controlled_secret");
  const tampered = sign(
    JSON.stringify({ ...JSON.parse(PAYLOAD), type: "invoice.payment_failed" }),
    PRIMARY_SECRET,
  );

  const configs: Array<[string, { primary?: string | null; legacy?: string | null }]> = [
    ["primary only", { primary: PRIMARY_SECRET }],
    ["primary + legacy", { primary: PRIMARY_SECRET, legacy: LEGACY_SECRET }],
    ["no secrets configured", { primary: null }],
  ];

  for (const [label, config] of configs) {
    assertEq(`malformed header — ${label}`, verify("not-a-signature", config), "rejected");
    assertEq(`empty header — ${label}`, verify("", config), "rejected");
    assertEq(
      `well-formed header, wrong secret — ${label}`,
      verify(forged, config),
      "rejected",
    );
    assertEq(
      `valid signature for a DIFFERENT payload — ${label}`,
      verify(tampered, config),
      "rejected",
    );
  }

  // A correctly-signed event must not slip through when nothing is configured.
  assertEq(
    "primary-signed event with no secrets configured",
    verify(primarySigned, { primary: null }),
    "rejected",
  );
});

run("rejection surfaces Stripe's own error, not a generic one", () => {
  // The route reports err.message to the caller, so the primary account's real
  // verification error must be what propagates when nothing validates.
  let message = "";
  try {
    constructWebhookEvent(
      stripe,
      PAYLOAD,
      "not-a-signature",
      webhookSecretCandidates(PRIMARY_SECRET, LEGACY_SECRET),
    );
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assertEq("a Stripe signature-verification message is thrown", message.length > 0, true);
  assertEq(
    "and it does not leak any signing secret",
    message.includes(PRIMARY_SECRET) || message.includes(LEGACY_SECRET),
    false,
  );
});

console.log(
  failures === 0
    ? "\nAll Stripe webhook secret tests passed."
    : `\n${failures} Stripe webhook secret test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);

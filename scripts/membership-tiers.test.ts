/* eslint-disable no-console */
// scripts/membership-tiers.test.ts
//
// GUARD TEST for the Snappd tier, which was on sale and unrepresentable.
//
// Snappd ($14.99/mo, $149.99/yr) had an active membership_tiers row with live
// Stripe payment links on both intervals and a tile on /register, but existed
// nowhere in the entitlement path:
//   * classifyPrice() had no 1499/14999 case, so a buyer fell through to its
//     final safety net ("any positive recurring amount grants at least
//     Superfan") and was provisioned as a $2.99 Superfan.
//   * profiles_role_check only allowed free|superfan|artist|admin, so writing
//     role='snappd' would have raised 23514 — and the members webhook returns
//     500 on a failed membership write so Stripe retries, meaning a code-only
//     fix would have produced an infinite retry against a charged customer.
//
// The safety net is deliberate and stays: it exists so a coupon or a price
// change never silently drops a PAYING member to free. What this test pins is
// that every tier we actually sell is classified EXACTLY, so the net is only
// ever reached by something genuinely unexpected.
//
// Run:  npx tsx scripts/membership-tiers.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMembershipUpdate, classifyPrice } from "@/lib/membership-sync";
import { isArtistSubscriber, isSuperfanOrBetter, tierOf } from "@/lib/membership";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown = true) {
  if (actual === expected) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

console.log("\nMembership tier contracts\n");

// --- every tier we sell classifies exactly ---------------------------------

const priced: [number, string, string][] = [
  [299, "superfan", "month"],
  [2999, "superfan", "year"],
  [499, "artist", "month"],
  [4999, "artist", "year"],
  [1499, "snappd", "month"],
  [14999, "snappd", "year"],
];
for (const [amount, tier, interval] of priced) {
  const got = classifyPrice(amount);
  check(`$${(amount / 100).toFixed(2)} is ${tier}`, got.tier, tier);
  check(`$${(amount / 100).toFixed(2)} is billed per ${interval}`, got.interval, interval);
}

// The specific regression: Snappd must never be swallowed by the safety net.
check("Snappd monthly is not misread as Superfan", classifyPrice(1499).tier !== "superfan");
check("Snappd yearly is not misread as Superfan", classifyPrice(14999).tier !== "superfan");

// The safety net itself still protects a paying member from dropping to free.
check("an unrecognised paid amount still grants a paid tier", classifyPrice(777).tier, "superfan");
check("a zero amount grants nothing", classifyPrice(0).tier, null);
check("a null amount grants nothing", classifyPrice(null).tier, null);

// --- gates ------------------------------------------------------------------

const snappd = { role: "snappd", membership_status: "active" };
check("a Snappd member resolves to the snappd tier", tierOf(snappd), "snappd");
check("a Snappd member clears the Superfan gate", isSuperfanOrBetter(snappd));
check("a Snappd member has studio and gallery access", isArtistSubscriber(snappd));
check("a free member still has no studio access", isArtistSubscriber({ role: "free" }), false);
check("a Superfan still has no studio access", isArtistSubscriber({ role: "superfan" }), false);
check("an Artist still has studio access", isArtistSubscriber({ role: "artist" }));
check("an admin still has studio access", isArtistSubscriber({ role: "admin" }));

// --- the write ---------------------------------------------------------------

const update = buildMembershipUpdate(
  {
    tier: "snappd",
    interval: "month",
    customerId: "cus_x",
    subscriptionId: "sub_x",
    status: "active",
    currentPeriodEnd: null,
  },
  { role: "free" },
);
check("a Snappd purchase writes role=snappd", update.role, "snappd");
check("a Snappd purchase writes membership_tier=snappd", update.membership_tier, "snappd");

const canceled = buildMembershipUpdate(
  { tier: "snappd", interval: "month", customerId: null, subscriptionId: null, status: "canceled", canceled: true },
  { role: "snappd" },
);
check("cancelling a Snappd member drops them to free", canceled.role, "free");

// --- the database has to accept it -------------------------------------------
// A code-only fix is worse than the bug: role='snappd' against the old CHECK
// raises 23514, the webhook 500s, and Stripe retries forever.

const migration = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "069_snappd_role.sql"),
  "utf8",
);
check("migration 069 allows the snappd role", /'snappd'/.test(migration));
for (const role of ["free", "superfan", "artist", "admin"]) {
  check(`migration 069 still allows ${role}`, migration.includes(`'${role}'`));
}

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll membership tier contracts passed.\n");
process.exit(failures ? 1 : 0);

/* eslint-disable no-console */
// scripts/auth-cookie-name.test.ts
//
// THE OUTAGE THIS PINS
// --------------------
// The signup wall gates every non-public route on the presence of a session
// COOKIE. It was written to match `sb-<project-ref>-auth-token` — the name
// supabase-js writes when you leave `storageKey` alone. Melori does not leave it
// alone: src/lib/supabase.ts sets `storageKey: AUTH_STORAGE_KEY` ("melori-auth")
// and the cookie adapter chunks it as `melori-auth.0`, `melori-auth.1`, …
//
// So on a real signed-in browser the gate matched NOTHING. Every member, on
// every gated route, was told "no session" and redirected to the door — which
// read the same session client-side, found it valid, and sent them back. A
// login loop with no exit, shipped to production, for everyone with an account.
//
// The bug was a one-line regex. The DEFECT was that the code writing the cookie
// name and the code reading it were free to disagree, and nothing failed until
// members did. This test removes that freedom.
//
// Run:  npx tsx scripts/auth-cookie-name.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_STORAGE_KEY,
  isAuthCookieName,
  isLegacySupabaseAuthCookieName,
} from "@/lib/authStorageKey";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok   ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL ${label}`); };
const check = (label: string, cond: boolean) => (cond ? ok(label) : bad(label));

console.log("\nAuth cookie name — writer and reader must agree\n");

// ---------------------------------------------------------------------------
// The exact cookies a signed-in browser carried in production when the loop was
// found. If the matcher stops accepting these, members are locked out again.
const REAL_BROWSER_COOKIES = [
  `${AUTH_STORAGE_KEY}.0`,
  `${AUTH_STORAGE_KEY}.1`,
  `${AUTH_STORAGE_KEY}.2`,
];
for (const name of REAL_BROWSER_COOKIES) {
  check(`the gate accepts ${name} (observed on a real signed-in browser)`, isAuthCookieName(name));
}
check(
  `the gate accepts the unchunked ${AUTH_STORAGE_KEY}`,
  isAuthCookieName(AUTH_STORAGE_KEY),
);

// Sessions created before the cookie adapter shipped are still real sessions.
check(
  "the gate still honours the legacy supabase-js cookie format",
  isLegacySupabaseAuthCookieName("sb-ouvovhwizsuhjxxmccex-auth-token") &&
    isLegacySupabaseAuthCookieName("sb-ouvovhwizsuhjxxmccex-auth-token.0"),
);

// ---------------------------------------------------------------------------
// Not everything that starts with the key is the session.
const NOT_THE_SESSION = [
  `${AUTH_STORAGE_KEY}-code-verifier`,
  `${AUTH_STORAGE_KEY}.x`,
  `${AUTH_STORAGE_KEY}.0.0`,
  `not-${AUTH_STORAGE_KEY}`,
  "melori-theme",
  "",
];
for (const name of NOT_THE_SESSION) {
  check(`${name || "(empty)"} is not treated as a session cookie`, !isAuthCookieName(name));
}

// ---------------------------------------------------------------------------
// THE DRIFT GUARD. Both sides must derive the name from the shared constant —
// a hard-coded string on either side is how the outage happened.
const supabaseClient = read("src/lib/supabase.ts");
const proxy = read("src/proxy.ts");

check(
  "the browser client takes its storageKey from the shared constant",
  supabaseClient.includes('from "@/lib/authStorageKey"') &&
    supabaseClient.includes("storageKey: AUTH_STORAGE_KEY") &&
    !supabaseClient.includes('"melori-auth"'),
);
check(
  "the proxy gate takes the cookie name from the same shared constant",
  proxy.includes('from "@/lib/authStorageKey"') &&
    proxy.includes("isAuthCookieName(cookie.name)"),
);
check(
  "the proxy no longer hard-codes the supabase-js default cookie name inline",
  !proxy.includes("/^sb-.+-auth-token"),
);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);

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
  hasSessionCookie,
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


// ---------------------------------------------------------------------------
// THE CLIENT SIDE OF THE SAME QUESTION.
//
// The proxy asks "does this REQUEST carry a session?" of the edge. The
// transport asks "does this BROWSER carry one?" of document.cookie, because
// since #365 the proxy REWRITES "/" to the door for a stranger — the signup
// form renders while usePathname() still reports "/". Testing the route alone
// put a playback bar and a draggable pill on top of the signup form for every
// visitor who reached melorimusic.org. Both questions now go through the
// matchers above, so they cannot answer differently.
console.log("\nSession presence in a document.cookie string\n");

const SIGNED_IN_COOKIE_STRING =
  `melori-theme=dark; ${AUTH_STORAGE_KEY}.0=eyJhY2Nl; ${AUTH_STORAGE_KEY}.1=c3NfdG9r; ` +
  `${AUTH_STORAGE_KEY}.2=ZW4ifQ; _vercel_jwt=xyz`;

check(
  "a real signed-in browser's cookie string reads as a session",
  hasSessionCookie(SIGNED_IN_COOKIE_STRING),
);
check(
  "the unchunked cookie alone reads as a session",
  hasSessionCookie(`${AUTH_STORAGE_KEY}=eyJhY2Nl`),
);
check(
  "a legacy supabase-js cookie still reads as a session",
  hasSessionCookie("sb-ouvovhwizsuhjxxmccex-auth-token=eyJhY2Nl"),
);
// e2e/support/door.ts plants exactly this to get browser specs past the door.
check(
  "the e2e door-bypass cookie counts, so browser specs can reach gated pages",
  hasSessionCookie("sb-e2e-auth-token=e2e-door-bypass-not-a-session"),
);

// THE CASE THE BUG WAS: a stranger on the door.
check(
  "a signed-out visitor's cookie string is NOT a session",
  !hasSessionCookie("melori-theme=dark; _vercel_jwt=xyz"),
);
check("an empty cookie string is not a session", !hasSessionCookie(""));
check("a missing cookie string is not a session", !hasSessionCookie(null));
// Mirrors hasSupabaseSession() in the proxy: the value has to be non-empty.
// A name with no value is a cookie that has been cleared.
check(
  "a cleared session cookie (name, empty value) is not a session",
  !hasSessionCookie(`${AUTH_STORAGE_KEY}.0=`),
);
check(
  "a near-miss name in a cookie string is not a session",
  !hasSessionCookie(`${AUTH_STORAGE_KEY}-code-verifier=abc; not-${AUTH_STORAGE_KEY}=abc`),
);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);

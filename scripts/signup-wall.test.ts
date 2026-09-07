/* eslint-disable no-console */
// scripts/signup-wall.test.ts
//
// Pins WHO CAN GET IN WITHOUT AN ACCOUNT.
//
// Before this wall, src/proxy.ts gated exactly one path — `/`. Every one of the
// 22 routes under /social answered 200 to a stranger, along with /dashboard,
// /settings, /upload and /studio. Several of those "checked" the session in a
// useEffect that runs AFTER the page has rendered, so the content shipped first
// and the redirect arrived second.
//
// The gate is an ALLOWLIST for a reason: a blocklist fails open every time
// someone adds a route, and nobody notices until a stranger is reading the feed.
// This test is the other half of that — it pins the allowlist's CONTENTS, so
// widening it is a deliberate act with a diff someone has to approve, not a
// side effect of a refactor.
//
// The two directions matter equally:
//   • a public route going dark silently breaks Karl's advertising, or worse,
//     locks the signup page behind signup;
//   • a gated route going public is the leak this whole change exists to close.
//
// Run:  npx tsx scripts/signup-wall.test.ts

import { isPublicPath } from "@/proxy";

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok    ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); };

// ---------------------------------------------------------------------------
// Public: the four groups the wall deliberately lets through.

const PUBLIC: [string, string][] = [
  // 1. The advertising.
  ["/gallery", "the gallery index — Karl's photography is the public surface"],
  ["/gallery/some-client-shoot", "an individual delivered gallery"],
  ["/photography", "the legacy path clients already hold (redirects to /gallery)"],
  ["/about", "Karl's introduction — the other half of the advertising"],

  // 2. The artists. Gating these would hide Kaiel R and Gloria Joy Rivers from
  //    search, which is backwards for a platform that needs traffic.
  ["/artists", "the artist index"],
  ["/artists/kaiel-r", "an artist profile"],
  ["/artists/gloria-joy-rivers", "an artist profile"],

  // 3. The way in. Gating any of these locks the front door from the inside.
  ["/platform", "the door itself"],
  ["/register", "signup"],
  ["/login", "sign in"],
  ["/social/auth", "the social sign-in surface"],
  ["/auth/callback", "the email-confirmation landing"],
  ["/forgot-password", "password recovery"],
  ["/reset-password", "password reset"],

  // 4. The obligations. App Review requires these without an account, and a
  //    privacy policy behind a login is indefensible anyway.
  ["/privacy", "privacy policy"],
  ["/terms", "terms"],
  ["/support", "support"],
  ["/mission", "the mission page"],
  ["/account-info", "the native account-info page"],

  // Runs its own JWT gate; adding it to the door locks Karl out.
  ["/admin", "the admin login page"],
];

for (const [path, why] of PUBLIC) {
  if (isPublicPath(path)) ok(`${path} stays public — ${why}`);
  else bad(`${path} is NO LONGER public — ${why}`);
}

// ---------------------------------------------------------------------------
// Gated: everything a stranger used to be able to read.

const GATED: string[] = [
  // Every social surface that answered 200 to a stranger before this wall.
  "/social",
  "/social/profile",
  "/social/profile/someone",
  "/social/messages",
  "/social/messages/abc123",
  "/social/spaces",
  "/social/spaces/create",
  "/social/spaces/abc123",
  "/social/cinema",
  "/social/cinema/create",
  "/social/cinema/abc123",
  "/social/concert",
  "/social/live",
  "/social/live/abc123",
  "/social/discover",
  "/social/community",
  "/social/connect",
  "/social/radio",
  "/social/video",
  "/social/mirror",
  "/social/blocked",
  // The catalog: since #353 every play button answers 401 to a stranger, so
  // showing it was showing a product they cannot use.
  "/music",
  "/music/123",
  "/music/album/some-album",
  "/albums",
  "/featured-artist",
  // Surfaces that only redirected AFTER rendering.
  "/dashboard",
  "/settings",
  "/upload",
  "/studio",
  "/studio/services",
  // Account and commerce.
  "/account",
  "/onboarding",
  "/connect",
  "/video",
  "/superfan",
];

for (const path of GATED) {
  if (!isPublicPath(path)) ok(`${path} requires an account`);
  else bad(`${path} IS REACHABLE WITHOUT AN ACCOUNT`);
}

// ---------------------------------------------------------------------------
// The specific trap: /social/auth is public, so a careless "/social" prefix
// would open all 22 social routes at once. This is the assertion that catches
// that exact mistake.

if (isPublicPath("/social/auth") && !isPublicPath("/social/spaces")) {
  ok("/social/auth is public WITHOUT opening the rest of /social");
} else {
  bad("the /social/auth exception has leaked into the rest of /social");
}

// A prefix entry must not match a longer sibling it was never meant to cover.
if (!isPublicPath("/gallerylistings") && isPublicPath("/gallery/x")) {
  ok("/gallery/ matches children without matching /gallerylistings");
} else {
  bad("the /gallery prefix matches a sibling route it should not");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

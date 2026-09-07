import type { BrowserContext } from "@playwright/test";

// Getting past "the door" in tests.
//
// src/proxy.ts rewrites `/` to /platform (the signup page) for any request
// that arrives without a Supabase session cookie. That is correct product
// behaviour — since #353 an unauthenticated visitor cannot play anything, so
// the catalog is a dead end for them — but it means a Playwright browser,
// which starts with an empty cookie jar, never reaches the home page at all.
// Every spec that asserts something about the home page has to declare itself
// a member first.
//
// The proxy's check (hasSupabaseSession) is a deliberate PRESENCE test: any
// non-empty `sb-<ref>-auth-token` cookie counts. It does not verify the token,
// because a stale cookie showing someone the app is harmless while the reverse
// would lock a real member out of their own site.
//
// So the cookie below does not have to be a real session, and is not one. It
// carries no credentials and grants nothing: server routes still verify the
// bearer token themselves, and supabase-js parses this value, fails, and
// reports no session — which is exactly what these specs want, since they seed
// their own track into localStorage rather than reading the catalog.
//
// If the proxy's cookie test ever tightens to real verification, these specs
// will fail at the door with a clear symptom (the signup page instead of the
// player), and this helper is the one place that needs to learn the new rule.
const DOOR_COOKIE_NAME = "sb-e2e-auth-token";
const DOOR_COOKIE_VALUE = "e2e-door-bypass-not-a-session";

export async function bypassDoor(context: BrowserContext, baseURL?: string) {
  await context.addCookies([
    {
      name: DOOR_COOKIE_NAME,
      value: DOOR_COOKIE_VALUE,
      url: baseURL ?? "http://127.0.0.1:3000",
    },
  ]);
}

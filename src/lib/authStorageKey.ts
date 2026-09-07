/**
 * The ONE name the browser session is stored under.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * It exists because the two halves of the auth check disagreed in production
 * and locked every signed-in member out of the app.
 *
 * `src/lib/supabase.ts` passes `storageKey` to the supabase-js browser client,
 * and `src/lib/supabaseCookieStorage.ts` writes that key to a cookie (chunked
 * as `<key>.0`, `<key>.1`, … once the session JSON outgrows one cookie). So a
 * signed-in member's browser carries `melori-auth.0`, `melori-auth.1`, …
 *
 * `src/proxy.ts` gates every non-public route on the presence of that cookie.
 * It was written to match `sb-<project-ref>-auth-token`, which is what
 * supabase-js uses when you DON'T override storageKey. We do override it. The
 * pattern therefore matched nothing, the gate concluded "no session" for every
 * signed-in request, and redirected to the door — which, seeing a perfectly
 * valid session client-side, sent the member straight back. A login loop with
 * no way through, for everyone, on every gated route.
 *
 * The lesson is not "fix the regex". It is that the writer and the reader of a
 * cookie name must not be able to drift apart. Both now import this constant,
 * and scripts/auth-cookie-name.test.ts pins that they still do.
 *
 * Keep this module dependency-free: `src/proxy.ts` runs in the edge runtime and
 * must be able to import it without pulling in supabase-js or anything DOM.
 */
export const AUTH_STORAGE_KEY = "melori-auth";

/**
 * Matches the session cookie and every chunk of it.
 *
 * Built from AUTH_STORAGE_KEY rather than written out, so renaming the key in
 * one place cannot leave the gate matching the old name.
 */
export function isAuthCookieName(name: string): boolean {
  if (name === AUTH_STORAGE_KEY) return true;
  if (!name.startsWith(`${AUTH_STORAGE_KEY}.`)) return false;
  // Chunk suffixes are plain integers: `melori-auth.0`, `.1`, `.2`, …
  return /^\d+$/.test(name.slice(AUTH_STORAGE_KEY.length + 1));
}

/**
 * Accounts that signed in before the cookie adapter shipped can still be
 * holding a supabase-js default-format cookie. Those sessions are real, so the
 * gate honours them too rather than logging those members out on deploy day.
 */
export function isLegacySupabaseAuthCookieName(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}

/**
 * Presence test over a `document.cookie`-style string, for CLIENT code.
 *
 * src/proxy.ts asks the same question of the request on the edge; this asks it
 * of the browser. Both go through the matchers above, deliberately, so the two
 * halves of "is this visitor signed in?" cannot answer differently — which is
 * the failure mode that locked every member out on 2026-09-07.
 *
 * Mirrors hasSupabaseSession() in the proxy exactly: the NAME must match and
 * the VALUE must be non-empty. A name with no value is a cleared cookie.
 */
export function hasSessionCookie(cookieString: string | null | undefined): boolean {
  if (!cookieString) return false;
  return cookieString.split(";").some((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return false;
    const rawName = part.slice(0, eq).trim();
    const rawValue = part.slice(eq + 1).trim();
    if (!rawName || !rawValue) return false;
    // Cookies are written through encodeURIComponent (see
    // src/lib/supabaseCookieStorage.ts). Nothing in the current names needs
    // escaping, but decode anyway rather than depend on that staying true.
    let name = rawName;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      /* not valid percent-encoding — match the raw name instead */
    }
    return isAuthCookieName(name) || isLegacySupabaseAuthCookieName(name);
  });
}

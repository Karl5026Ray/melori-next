// Cookie-backed storage adapter for the Supabase browser client.
//
// WHY THIS EXISTS
// ---------------
// Supabase's PKCE flow generates a `code_verifier` at the start of "Continue
// with Google" and must read that SAME verifier back on `/auth/callback` to
// exchange the `?code=` for a session. By default supabase-js stores it in
// localStorage, which is isolated per browser storage partition. That produces
// the recurring error:
//
//   "PKCE code verifier not found in storage."
//
// ...whenever the callback runs in a DIFFERENT storage context than the one
// that started the flow. The common real-world triggers on mobile are:
//   • In-app webviews (Instagram / TikTok / Facebook / Gmail) that don't share
//     Safari/Chrome localStorage, or hand the callback to a different browser.
//   • Private / incognito tabs and aggressive ITP storage eviction.
//   • A stale bookmarked `?code=...` URL opened later.
//
// Cookies are sent with the request regardless of which localStorage happens to
// be active, so writing the verifier (and the session) to a cookie makes the
// exchange survive all of the above.
//
// IMPORTANT — this does NOT change the app's auth model. Consumers still call
// `supabase.auth.getSession()` / `getUser()` and forward the access token as
// `Authorization: Bearer <token>` (see authClient.ts, membership-server.ts).
// We only change WHERE the SDK persists its own state. No @supabase/ssr, no
// middleware, no server-route changes.
//
// Values can exceed a single cookie's ~4KB limit (the session JSON is large),
// so we transparently chunk across `<key>.0`, `<key>.1`, ... cookies.

const MAX_CHUNK = 3200; // headroom under the 4096-byte per-cookie limit
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year (session refresh governs real expiry)

// Cookies are scoped to the current host. The www→apex redirect (PR #112)
// already guarantees a single canonical origin, so a host-scoped cookie is
// seen by both the OAuth-initiating page and the /auth/callback page.
function cookieAttributes(): string {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  // Lax lets the cookie ride along on the top-level GET redirect back from
  // Google (a cross-site navigation), which "Strict" would drop.
  return `; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function readRawCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const parts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

function writeRawCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value,
  )}${cookieAttributes()}`;
}

function deleteRawCookie(name: string): void {
  if (typeof document === "undefined") return;
  const secure =
    window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(
    name,
  )}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

// How many chunk-cookies currently exist for `key` (stored at key.0, key.1, …).
function countChunks(key: string): number {
  let n = 0;
  while (readRawCookie(`${key}.${n}`) !== null) n++;
  return n;
}

export const cookieStorageAdapter = {
  getItem(key: string): string | null {
    // Fast path: value fits in a single cookie.
    const single = readRawCookie(key);
    if (single !== null) return single;

    // Chunked path: reassemble key.0 + key.1 + …
    const chunks = countChunks(key);
    if (chunks === 0) return null;
    let out = "";
    for (let i = 0; i < chunks; i++) {
      const piece = readRawCookie(`${key}.${i}`);
      if (piece === null) return null; // incomplete → treat as absent
      out += piece;
    }
    return out;
  },

  setItem(key: string, value: string): void {
    // Clear any previous representation (single or chunked) before rewriting so
    // stale chunks can't corrupt reassembly.
    deleteRawCookie(key);
    for (let i = 0; i < countChunks(key); i++) deleteRawCookie(`${key}.${i}`);

    if (value.length <= MAX_CHUNK) {
      writeRawCookie(key, value);
      return;
    }
    let index = 0;
    for (let start = 0; start < value.length; start += MAX_CHUNK) {
      writeRawCookie(`${key}.${index}`, value.slice(start, start + MAX_CHUNK));
      index++;
    }
  },

  removeItem(key: string): void {
    deleteRawCookie(key);
    let i = 0;
    while (readRawCookie(`${key}.${i}`) !== null) {
      deleteRawCookie(`${key}.${i}`);
      i++;
    }
  },
};

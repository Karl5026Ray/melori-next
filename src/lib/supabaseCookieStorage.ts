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
//
// Cookies alone are not durable enough, though: WebKit's ITP caps the lifetime
// of script-written cookies at 7 days, which silently signs iOS users out. So
// `authStorageAdapter` (bottom of this file) mirrors every write into
// localStorage and reads cookie-first with a localStorage fallback. The cookie
// remains the primary store — that is what makes PKCE survive a storage
// partition change — and the mirror only has to cover eviction.

// Budget for ONE cookie's value, measured in ENCODED bytes. The browser's
// ~4096-byte per-cookie limit applies to the percent-encoded `name=value` pair
// that is actually stored, not to the raw JS string: a session containing
// accented names, JSON punctuation or CJK inflates 1.3-2.6x through
// encodeURIComponent. Measuring raw `.length` (as this did previously) left a
// user with both Google and Apple identities linked ~40 bytes under the limit,
// and going over is silent — the browser just discards the cookie and the next
// read looks like "signed out". 1500 keeps several chunks' worth of headroom.
const MAX_CHUNK_ENCODED_BYTES = 1500;
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

// Delete key.0, key.1, … up to the first gap. Reading each index BEFORE
// deleting it is what makes this correct: an earlier version looped to
// `countChunks(key)`, which was re-evaluated every iteration and collapsed to 0
// as soon as `.0` was gone — so a 3-chunk value rewritten as 2 chunks kept its
// orphaned `.2`, and the next read reassembled new data followed by stale
// tail bytes. auth-js swallows the resulting JSON.parse error and returns null,
// which is indistinguishable from being signed out.
function deleteChunks(key: string): void {
  for (let i = 0; readRawCookie(`${key}.${i}`) !== null; i++) {
    deleteRawCookie(`${key}.${i}`);
  }
}

// Split `value` so that each piece stays within `limit` encoded bytes.
// Iterating with for…of walks whole code points, so an astral character
// (emoji) is never torn across two cookies.
function splitByEncodedBytes(value: string, limit: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of value) {
    const charBytes = encodeURIComponent(char).length;
    if (current !== "" && currentBytes + charBytes > limit) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current !== "") chunks.push(current);
  return chunks;
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
    deleteChunks(key);

    const chunks = splitByEncodedBytes(value, MAX_CHUNK_ENCODED_BYTES);
    if (chunks.length <= 1) {
      writeRawCookie(key, value);
      return;
    }
    chunks.forEach((chunk, index) => writeRawCookie(`${key}.${index}`, chunk));
  },

  removeItem(key: string): void {
    deleteRawCookie(key);
    deleteChunks(key);
  },
};

// ---------------------------------------------------------------------------
// localStorage mirror
// ---------------------------------------------------------------------------

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // Safari private mode / storage disabled.
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* best-effort mirror; the cookie is still authoritative */
  }
}

function removeLocalStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/**
 * The adapter the Supabase client actually uses. Cookie-primary (so PKCE keeps
 * working across storage partitions and in-app webviews) with a localStorage
 * mirror, so losing either store on its own does not sign the user out.
 */
export const authStorageAdapter = {
  getItem(key: string): string | null {
    const fromCookie = cookieStorageAdapter.getItem(key);
    if (fromCookie !== null) return fromCookie;

    const fromLocalStorage = readLocalStorage(key);
    // Cookie gone but the mirror survived — almost always ITP's 7-day cap on
    // script-written cookies. Rewrite the cookie so the next OAuth redirect
    // still finds the value in the store that crosses partitions.
    if (fromLocalStorage !== null) {
      cookieStorageAdapter.setItem(key, fromLocalStorage);
    }
    return fromLocalStorage;
  },

  setItem(key: string, value: string): void {
    cookieStorageAdapter.setItem(key, value);
    writeLocalStorage(key, value);
  },

  removeItem(key: string): void {
    cookieStorageAdapter.removeItem(key);
    removeLocalStorage(key);
  },
};
